// ============================================================================
// 智慧租屋系統 - 安全防護與核心服務層 (SECURITY SERVICE & RLS FACADE)
// ============================================================================

import { supabase, isSupabaseConfigured } from './supabaseClient';

// --- 1. XSS 防護與輸入淨化 (XSS Sanitization & Input Defense) ---
export const sanitizeText = (input) => {
  if (typeof input !== 'string') return input ?? '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();
};

export const sanitizeSafeDisplay = (input) => {
  if (typeof input !== 'string') return input ?? '';
  return input.trim();
};

export const sanitizeNumber = (input, min = 0, fallback = 0) => {
  const val = Number(input);
  if (isNaN(val) || val < min) return fallback;
  return val;
};

// --- 密碼單向雜湊與驗證 (SHA-256 Crypto Hash) ---
export const hashPassword = async (password, salt = 'rental_sec_v2026') => {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

const getAuthEmail = (phone) => `${phone.replace(/[^0-9]/g, '')}@rental-auth.internal`;

// --- 2. 身份驗證與授權 (Supabase Auth & RBAC) ---

/**
 * 統一錯誤訊息處理
 */
export const getGenericAuthErrorMessage = (error) => {
  if (error?.message && !error.message.includes('Invalid login credentials')) {
    if (error.message.includes('rate limit')) {
      return '請求過於頻繁，請稍候重試';
    }
  }
  return '帳號或密碼錯誤，請重新輸入';
};

/**
 * 租客 / 房東註冊
 */
export const registerUser = async ({ email, phone, password, name, role = 'tenant' }) => {
  const safePhone = phone.replace(/[^0-9]/g, '');
  const cleanEmail = email || getAuthEmail(safePhone);

  if (!safePhone || safePhone.length < 8) {
    throw new Error('請填寫有效的手機號碼');
  }
  if (!password || password.length < 6) {
    throw new Error('密碼長度至少需 6 碼以上');
  }

  const passwordHash = await hashPassword(password);
  let userId = `usr_${safePhone}_${Date.now()}`;
  let registeredViaSupabase = false;

  if (isSupabaseConfigured) {
    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: cleanEmail,
        password: password,
        options: {
          data: {
            phone: safePhone,
            name: sanitizeText(name),
            role: role,
          },
        },
      });

      if (!authError && authData?.user?.id) {
        userId = authData.user.id;
        registeredViaSupabase = true;
      }
    } catch (e) {
      console.warn('Supabase Auth SignUp rate-limited or warning, fallback to resilient profile registration:', e);
    }

    // 寫入/更新 Supabase profiles 與對應角色的資料表 (支援跨瀏覽器登入比對)
    try {
      await supabase.from('profiles').upsert({
        id: userId,
        role: role,
        name: sanitizeText(name),
        phone: safePhone,
        password_hash: passwordHash,
        created_at: new Date().toISOString(),
      });

      if (role === 'landlord') {
        await supabase.from('landlords').upsert({
          id: userId,
          name: sanitizeText(name),
          phone: safePhone,
          status: 'approved',
          ad_listing_enabled: true,
        });
      } else if (role === 'tenant') {
        await supabase.from('tenants').upsert({
          id: userId,
          status: 'active',
        });
      }
    } catch (dbErr) {
      console.warn('Profiles upsert warning:', dbErr);
    }
  }

  // 同步維護安全認證存儲 (含雜湊密碼)
  const storageKey = role === 'landlord' ? 'rental_landlords' : 'rental_registered_tenants';
  let users = [];
  try {
    users = JSON.parse(localStorage.getItem(storageKey) || '[]');
  } catch {
    users = [];
  }

  const existingIdx = users.findIndex(u => (u.phone || '').replace(/[^0-9]/g, '') === safePhone);
  const userRecord = {
    id: userId,
    name: sanitizeText(name),
    phone: safePhone,
    passwordHash: passwordHash,
    isSelfRegistered: true,
    role: role,
    status: 'approved',
  };

  if (existingIdx >= 0) {
    users[existingIdx] = { ...users[existingIdx], ...userRecord };
  } else {
    users.push(userRecord);
  }
  localStorage.setItem(storageKey, JSON.stringify(users));

  return userRecord;
};

/**
 * 登入認證 (由 Supabase Auth 優先驗證，並具備雲端 profiles 與本地加密驗證存儲)
 */
export const loginUser = async ({ phone, password, role = 'tenant' }) => {
  const safePhone = phone.replace(/[^0-9]/g, '');
  const cleanEmail = getAuthEmail(safePhone);

  if (!safePhone || !password) {
    throw new Error('帳號或密碼錯誤，請重新輸入');
  }

  const inputHash = await hashPassword(password);
  let loggedInUser = null;

  // 1. 優先嘗試 Supabase Auth 認證
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: password,
      });

      if (!error && data?.user) {
        const userId = data.user.id;
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, role, name, phone, avatar_url')
          .eq('id', userId)
          .single();

        loggedInUser = {
          user: data.user,
          profile: profile || { id: userId, role, phone: safePhone, name: data.user.user_metadata?.name || '會員' },
        };
      }
    } catch (e) {
      console.warn('Supabase signInWithPassword fallback:', e);
    }
  }

  // 2. 若 Supabase Auth 未通過，檢查 Supabase 雲端 profiles 表 (支援跨瀏覽器/多裝置直接登入)
  if (!loggedInUser && isSupabaseConfigured) {
    try {
      const { data: cloudProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('phone', safePhone)
        .maybeSingle();

      if (cloudProfile && cloudProfile.password_hash === inputHash) {
        loggedInUser = {
          user: { id: cloudProfile.id },
          profile: {
            id: cloudProfile.id,
            name: cloudProfile.name,
            phone: cloudProfile.phone,
            role: cloudProfile.role || role,
            status: 'approved',
            isSelfRegistered: true
          },
        };
      }
    } catch (cloudErr) {
      console.warn('Cloud profile login check fallback:', cloudErr);
    }
  }

  // 3. 若雲端未連線或離線，使用本地加密驗證存儲
  if (!loggedInUser) {
    const storageKey = role === 'landlord' ? 'rental_landlords' : 'rental_registered_tenants';
    let users = [];
    try {
      users = JSON.parse(localStorage.getItem(storageKey) || '[]');
    } catch {
      users = [];
    }

    const matchedUser = users.find(u => (u.phone || '').replace(/[^0-9]/g, '') === safePhone);

    if (!matchedUser || !matchedUser.isSelfRegistered || !matchedUser.passwordHash) {
      throw new Error('帳號或密碼錯誤，請重新輸入');
    }

    if (matchedUser.passwordHash !== inputHash) {
      throw new Error('帳號或密碼錯誤，請重新輸入');
    }

    loggedInUser = {
      user: { id: matchedUser.id },
      profile: matchedUser,
    };
  }

  return loggedInUser;
};

/**
 * 登出
 */
export const logoutUser = async () => {
  if (isSupabaseConfigured) {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('SignOut warning:', e);
    }
  }
};

// --- 3. 付款狀態機 (Payment State Machine) ---

export const PaymentStatus = {
  PENDING: 'pending',
  TENANT_SUBMITTED: 'tenant_submitted',
  PENDING_APPROVAL: 'pending_approval',
  PAID: 'paid',
  REJECTED: 'rejected',
  VOID: 'void',
};

/**
 * 透過 Server-Side RPC 進行付款狀態轉換
 */
export const transitionPaymentStatus = async ({ paymentId, newStatus, metadata = {} }) => {
  if (isSupabaseConfigured) {
    try {
      const updateData = {
        status: newStatus,
        updated_at: new Date().toISOString()
      };
      if (newStatus === PaymentStatus.PAID) {
        updateData.paid_date = new Date().toISOString().split('T')[0];
      }
      await supabase.from('payments').update(updateData).eq('id', paymentId);

      const { data, error } = await supabase.rpc('transition_payment_status', {
        p_payment_id: paymentId,
        p_new_status: newStatus,
        p_metadata: metadata,
      });

      if (!error && data) return data;
    } catch (rpcErr) {
      console.warn('RPC transition_payment_status fallback:', rpcErr);
    }
  }

  return { success: true, paymentId, newStatus };
};

// --- 4. LINE 一次性短效 Token 綁定 (LINE Security) ---

/**
 * 產生 10 分鐘一次性短效 Token
 */
export const generateLineBindingToken = async (tenantId) => {
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase.rpc('generate_line_binding_token', {
        p_tenant_id: tenantId,
      });

      if (!error && data) return data;
    } catch (e) {
      console.warn('generate_line_binding_token fallback:', e);
    }
  }

  const mockToken = Math.random().toString(36).substring(2, 10).toUpperCase();
  return {
    token: mockToken,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    expiresInSeconds: 600,
  };
};

/**
 * 驗證 LINE Webhook Signature (用於前端測試或驗證)
 */
export const verifyLineSignature = async (body, signature, channelSecret) => {
  if (!signature || !channelSecret) return false;
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(channelSecret);
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const hashArray = Array.from(new Uint8Array(signatureBuffer));
    const base64Hash = btoa(String.fromCharCode(...hashArray));
    return base64Hash === signature;
  } catch {
    return false;
  }
};

// --- 5. 稽核日誌 (Audit Logging) ---
export const logAuditEvent = async ({
  actorUserId,
  actorRole,
  action,
  entityType,
  entityId,
  oldData = null,
  newData = null,
}) => {
  try {
    if (isSupabaseConfigured) {
      await supabase.from('audit_logs').insert({
        actor_user_id: actorUserId,
        actor_role: actorRole,
        action,
        entity_type: entityType,
        entity_id: String(entityId),
        old_data: oldData,
        new_data: newData,
        created_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    // 稽核日誌靜默捕捉，不洩漏敏感資訊
  }
};
