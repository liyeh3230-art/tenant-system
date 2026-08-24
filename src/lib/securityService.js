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
export const registerUser = async ({ email, phone, password, name, requestedRole = 'tenant' }) => {
  const safePhone = phone.replace(/[^0-9]/g, '');
  const cleanEmail = email || getAuthEmail(safePhone);

  if (!safePhone || safePhone.length < 8) {
    throw new Error('請填寫有效的手機號碼');
  }
  if (!password || password.length < 6) {
    throw new Error('密碼長度至少需 6 碼以上');
  }

  if (!isSupabaseConfigured) {
    throw new Error('系統尚未完成安全的 Supabase 設定，暫時無法註冊。');
  }

  // 僅允許「租客」或「申請成為房東」；絕不接受前端指定管理員角色。
  const safeRequestedRole = requestedRole === 'landlord' ? 'landlord' : 'tenant';
  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
    options: {
      data: {
        phone: safePhone,
        name: sanitizeText(name),
        requested_role: safeRequestedRole,
      },
    },
  });

  if (error || !data.user) {
    throw error || new Error('註冊失敗，請稍後再試。');
  }

  // profiles、tenants、landlords 均由資料庫 trigger 以 auth.uid() 建立。
  // 瀏覽器不再能自行 upsert profile、寫入角色或儲存密碼雜湊。
  return {
    user: data.user,
    hasSession: Boolean(data.session),
    needsEmailConfirmation: !data.session,
  };
};

/**
 * 登入認證 (由 Supabase Auth 優先驗證，並具備雲端 profiles 與本地加密驗證存儲)
 */
export const loginUser = async ({ phone, password, expectedRole = 'tenant' }) => {
  const safePhone = phone.replace(/[^0-9]/g, '');
  const cleanEmail = getAuthEmail(safePhone);

  if (!safePhone || !password) {
    throw new Error('帳號或密碼錯誤，請重新輸入');
  }

  if (!isSupabaseConfigured) {
    throw new Error('系統尚未完成安全的 Supabase 設定，暫時無法登入。');
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: cleanEmail,
    password,
  });
  if (error || !data.user) {
    throw error || new Error('帳號或密碼錯誤，請重新輸入');
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role, name, phone, avatar_url')
    .eq('id', data.user.id)
    .single();
  if (profileError || !profile) {
    await supabase.auth.signOut();
    throw new Error('帳戶資料尚未初始化，請稍後重試或聯絡管理員。');
  }

  const isSuperadmin = data.user.app_metadata?.role === 'superadmin';
  if (expectedRole === 'superadmin') {
    if (!isSuperadmin) {
      await supabase.auth.signOut();
      throw new Error('此帳戶沒有系統管理員權限。');
    }
  } else if (profile.role !== expectedRole) {
    await supabase.auth.signOut();
    throw new Error('帳戶身分與登入入口不符。');
  }

  return { user: data.user, profile, isSuperadmin };
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
  if (!isSupabaseConfigured) {
    throw new Error('系統尚未完成安全設定，無法變更付款狀態。');
  }

  // 狀態轉換只准由資料庫函式執行；禁止先在瀏覽器直接 update payments。
  const { data, error } = await supabase.rpc('transition_payment_status', {
    p_payment_id: paymentId,
    p_new_status: newStatus,
    p_metadata: metadata,
  });
  if (error || !data) {
    throw error || new Error('付款狀態更新失敗。');
  }
  return data;
};

// --- 4. LINE 一次性短效 Token 綁定 (LINE Security) ---

/**
 * 產生 10 分鐘一次性短效 Token
 */
export const generateLineBindingToken = async (tenantId) => {
  if (!isSupabaseConfigured) {
    throw new Error('系統尚未完成安全設定，無法產生 LINE 綁定碼。');
  }

  const { data, error } = await supabase.rpc('generate_line_binding_token', {
    p_tenant_id: tenantId,
  });
  if (error || !data) {
    throw error || new Error('LINE 綁定碼產生失敗。');
  }
  return data;
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
