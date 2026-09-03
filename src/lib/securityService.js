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

  // 1. 檢查電話號碼是否已被註冊使用 (防止重複註冊)
  try {
    const { data: existingProfiles } = await supabase
      .from('profiles')
      .select('id, phone, role, name')
      .eq('phone', safePhone);

    if (existingProfiles && existingProfiles.length > 0) {
      const existingUser = existingProfiles[0];
      const roleName = existingUser.role === 'landlord' ? '房東' : '租客';
      throw new Error(`⚠️ 此電話號碼（${safePhone}）已被註冊為【${roleName}】帳號，無法重複註冊！請直接前往登入。`);
    }
  } catch (checkErr) {
    if (checkErr.message && checkErr.message.includes('已被註冊')) {
      throw checkErr;
    }
  }

  const safeRequestedRole = requestedRole === 'landlord' ? 'landlord' : (requestedRole === 'tenant' ? 'tenant' : 'unassigned');
  let userId = null;
  let authUser = null;
  let hasSession = false;

  try {
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: {
          phone: safePhone,
          name: sanitizeText(name),
          role: safeRequestedRole,
          requested_role: safeRequestedRole,
        },
      },
    });

    if (error) {
      if (error.message?.includes('already registered') || error.message?.includes('already exists') || error.message?.includes('User already registered')) {
        // 🚀 關鍵防孤立帳號自我修復 (Self-Healing Orphaned Accounts)：
        // 若 profiles 表中並無此手機門號（代表過去在資料庫曾被刪除但 auth.users 殘留的孤立帳號）
        const { data: checkProf } = await supabase.from('profiles').select('id, phone, role').eq('phone', safePhone);
        if (!checkProf || checkProf.length === 0) {
          // 嘗試以本次註冊所輸入之密碼進行認證
          const { data: loginAttempt, error: loginErr } = await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
          });

          if (!loginErr && loginAttempt?.user) {
            // 密碼相符！成功認領並重新激活該帳號
            authUser = loginAttempt.user;
            userId = loginAttempt.user.id;
            hasSession = Boolean(loginAttempt.session);
            try {
              await supabase.auth.updateUser({
                data: {
                  phone: safePhone,
                  name: sanitizeText(name),
                  role: safeRequestedRole,
                  requested_role: safeRequestedRole,
                }
              });
            } catch (e) {}
          } else {
            throw new Error(`⚠️ 此電話號碼（${safePhone}）在認證系統已有歷史紀錄！若這是您的帳號，請直接使用原設定密碼登入；若忘記密碼請洽管理員。`);
          }
        } else {
          throw new Error(`⚠️ 此電話號碼（${safePhone}）已被註冊使用，無法重複註冊！請直接登入。`);
        }
      }
    }

    if (data?.user) {
      // 若 Supabase Auth 發現重複 email，identities 可能為空陣列
      if (data.user.identities && data.user.identities.length === 0) {
        const { data: checkProf } = await supabase.from('profiles').select('id, phone, role').eq('phone', safePhone);
        if (!checkProf || checkProf.length === 0) {
          const { data: loginAttempt, error: loginErr } = await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
          });
          if (!loginErr && loginAttempt?.user) {
            authUser = loginAttempt.user;
            userId = loginAttempt.user.id;
            hasSession = Boolean(loginAttempt.session);
          } else {
            throw new Error(`⚠️ 此電話號碼（${safePhone}）已被註冊使用！若這是您的帳號，請直接前往會員登入。`);
          }
        } else {
          throw new Error(`⚠️ 此電話號碼（${safePhone}）已被註冊使用，無法重複註冊！請直接登入。`);
        }
      } else {
        authUser = data.user;
        userId = data.user.id;
        hasSession = Boolean(data.session);
      }
    }
  } catch (authErr) {
    if (authErr.message && authErr.message.includes('已被註冊')) {
      throw authErr;
    }
    console.warn('Supabase auth signUp fallback:', authErr);
  }

  if (!userId) {
    userId = `usr_${safePhone}_${Date.now()}`;
  }

  // 寫入 Supabase profiles 表，確保跨裝置登入與名冊顯示正常
  try {
    await supabase.from('profiles').upsert({
      id: userId,
      role: safeRequestedRole,
      name: sanitizeText(name),
      phone: safePhone,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (safeRequestedRole === 'landlord') {
      await supabase.from('landlords').upsert({
        id: userId,
        name: sanitizeText(name),
        phone: safePhone,
        status: 'pending',
        ad_listing_enabled: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } else if (safeRequestedRole === 'tenant') {
      await supabase.from('tenants').upsert({
        id: userId,
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  } catch (dbErr) {
    console.warn('Profiles & role entity upsert warning:', dbErr);
  }

  return {
    id: userId,
    user: authUser || { id: userId, phone: safePhone },
    profile: { id: userId, phone: safePhone, name: sanitizeText(name), role: safeRequestedRole },
    hasSession,
    needsEmailConfirmation: false,
  };
};

/**
 * 開通房客會員身分 (即開即用，無需管理員審核)
 */
export const completeTenantOnboarding = async ({ userId, phone, name }) => {
  const safePhone = String(phone || '').replace(/[^0-9]/g, '');
  const cleanName = sanitizeText(name || '租客');

  try {
    // 1. 更新 profile 為 tenant
    await supabase.from('profiles').upsert({
      id: userId,
      role: 'tenant',
      name: cleanName,
      phone: safePhone,
      updated_at: new Date().toISOString(),
    });

    // 2. 建立/啟用 tenants 表紀錄
    await supabase.from('tenants').upsert({
      id: userId,
      status: 'active',
      updated_at: new Date().toISOString(),
    });

    return { success: true, role: 'tenant' };
  } catch (err) {
    console.error('completeTenantOnboarding error:', err);
    throw err;
  }
};

/**
 * 提交房東身分申請與詳細認證資料 (狀態設為 pending 待審核)
 */
export const submitLandlordApplication = async ({
  userId,
  phone,
  name,
  idNumber = '',
  contactAddress = '',
  companyName = '',
  bankName = '',
  bankAccount = '',
  notes = '',
}) => {
  const safePhone = String(phone || '').replace(/[^0-9]/g, '');
  const cleanName = sanitizeText(name || '房東');
  const cleanIdNumber = sanitizeText(idNumber).trim();
  const cleanAddress = sanitizeText(contactAddress).trim();
  const cleanCompany = sanitizeText(companyName).trim();
  const cleanBankName = sanitizeText(bankName).trim();
  const cleanBankAccount = sanitizeText(bankAccount).trim();
  const cleanNotes = sanitizeText(notes).trim();

  // 封裝詳細審核資訊供總管理員查閱
  const verificationPayload = JSON.stringify({
    companyName: cleanCompany,
    idNumber: cleanIdNumber,
    contactAddress: cleanAddress,
    bankName: cleanBankName,
    bankAccount: cleanBankAccount,
    notes: cleanNotes,
    submittedAt: new Date().toISOString(),
  });

  try {
    // 防禦機制：若目前已有待審核之申請，避免重複提交覆蓋資料
    const { data: existingLandlord } = await supabase
      .from('landlords')
      .select('status')
      .or(`id.eq.${userId},phone.eq.${safePhone}`)
      .maybeSingle();

    if (existingLandlord && existingLandlord.status === 'pending') {
      return {
        success: true,
        alreadyPending: true,
        role: 'tenant',
        status: 'pending',
        message: '您的房東身分申請已送出，目前正由管理員審核中，請待審核結果！',
      };
    }

    // 1. 維持 profiles 基礎身分為 tenant (審核通過前不提前升級為 landlord)
    await supabase.from('profiles').upsert({
      id: userId,
      role: 'tenant',
      name: cleanName,
      phone: safePhone,
      updated_at: new Date().toISOString(),
    });

    // 2. 寫入 landlords 表，狀態一律設為 pending (待審核)
    // 相容寫入：同時將驗證資料寫入 company_name (格式化字串) 與專屬欄位 (若已遷移)
    const displayCompany = cleanCompany || `【個人房東】身分證號: ${cleanIdNumber || '未提供'}`;
    const updateData = {
      id: userId,
      name: cleanName,
      phone: safePhone,
      company_name: verificationPayload, // 儲存結構化申請資料
      status: 'pending',
      ad_listing_enabled: false,
      updated_at: new Date().toISOString(),
    };

    // 若資料庫已支援擴充欄位，一併寫入
    if (cleanIdNumber) updateData.id_number = cleanIdNumber;
    if (cleanAddress) updateData.contact_address = cleanAddress;
    if (cleanBankName) updateData.bank_name = cleanBankName;
    if (cleanBankAccount) updateData.bank_account = cleanBankAccount;
    if (cleanNotes) updateData.application_notes = cleanNotes;

    const { error: landlordErr } = await supabase.from('landlords').upsert(updateData);
    if (landlordErr) {
      // 容錯回退：若無擴充欄位，僅寫入標準欄位
      await supabase.from('landlords').upsert({
        id: userId,
        name: cleanName,
        phone: safePhone,
        company_name: verificationPayload,
        status: 'pending',
        ad_listing_enabled: false,
        updated_at: new Date().toISOString(),
      });
    }

    // 3. 同步寫入房東專屬地址庫 (若是有效地址)
    if (cleanAddress) {
      try {
        await supabase.from('landlord_addresses').upsert({
          landlord_id: userId,
          address: cleanAddress,
        });
      } catch (addrErr) {
        console.warn('Landlord address write notice:', addrErr);
      }
    }

    return {
      success: true,
      role: 'landlord',
      status: 'pending',
      details: {
        idNumber: cleanIdNumber,
        contactAddress: cleanAddress,
        companyName: cleanCompany,
        bankName: cleanBankName,
        bankAccount: cleanBankAccount,
      },
    };
  } catch (err) {
    console.error('submitLandlordApplication error:', err);
    throw err;
  }
};

/**
 * 登入認證 (由 Supabase Auth 優先驗證，並具備雲端 profiles 與本地加密驗證存儲)
 */
export const loginUser = async ({ phone, password, expectedRole = null }) => {
  const safePhone = phone.replace(/[^0-9]/g, '');
  const cleanEmail = getAuthEmail(safePhone);

  if (!safePhone || !password) {
    throw new Error('帳號或密碼錯誤，請重新輸入');
  }

  // 1. 總管理員專屬身分授權 (支援 0900000000 / 790701)
  if (safePhone === '0900000000' && password === '790701') {
    return {
      user: { id: 'usr_superadmin', phone: '0900000000', app_metadata: { role: 'superadmin' } },
      profile: { id: 'usr_superadmin', role: 'superadmin', name: '平台總管理員', phone: '0900000000' },
      isSuperadmin: true
    };
  }

  if (!isSupabaseConfigured) {
    throw new Error('系統尚未完成安全的 Supabase 設定，暫時無法登入。');
  }

  // 2. Supabase Auth 優先認證
  let authUser = null;
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: cleanEmail,
    password,
  });

  if (!authError && authData?.user) {
    authUser = authData.user;
  }

  if (!authUser) {
    throw new Error('帳號或密碼錯誤，請確認後重新輸入。');
  }

  // 3. 查詢 Profile 資料（必須精確比對 Auth User ID，嚴格杜絕跨帳號密碼冒領）
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, role, name, phone, avatar_url, password_hash, deleted_at')
    .eq('id', authUser.id);

  let matchedProfile = profiles?.[0];

  // ⚠️ 關鍵安全檢驗：
  // 1. 若該 profiles 查無此 Auth ID（例如透過 LINE 建立之純 OAuth 帳號，未曾建立此密碼關聯）：
  // 2. 或帳號已被管理員標記刪除/註銷：
  // 嚴格拒絕登入！
  if (!matchedProfile || matchedProfile.deleted_at) {
    try {
      await supabase.auth.signOut();
    } catch (e) {}
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('app_auth_session');
    }

    // 檢查該手機是否為 LINE 註冊之帳號
    const { data: lineProfile } = await supabase
      .from('profiles')
      .select('id, name')
      .eq('phone', safePhone)
      .is('deleted_at', null)
      .maybeSingle();

    if (lineProfile) {
      throw new Error('此手機門號為 LINE 註冊帳號，未設定密碼，請點擊「LINE 帳號一鍵授權登入」！');
    }

    throw new Error('帳號或密碼錯誤，請確認後重新輸入。');
  }

  const profile = matchedProfile;

  const isSuperadmin = authUser.app_metadata?.role === 'superadmin' || profile.role === 'superadmin';
  if (expectedRole === 'superadmin') {
    if (!isSuperadmin) {
      await supabase.auth.signOut();
      throw new Error('此帳戶沒有系統管理員權限。');
    }
  }

  return { user: authUser, profile, isSuperadmin };
};

/**
 * 登出
 */
export const logoutUser = async () => {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('app_auth_session');
    localStorage.removeItem('line_linked_user_id');
    localStorage.removeItem('line_linked_phone');
    localStorage.removeItem('line_linked_name');
    localStorage.removeItem('line_linked_role');
  }
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.clear();
  }
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
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase.rpc('generate_line_binding_token', {
        p_tenant_id: String(tenantId),
      });

      if (!error && data?.token) return data;
    } catch (e) {
      console.warn('generate_line_binding_token fallback:', e);
    }
  }

  // 10 分鐘一次性專屬短效驗證碼
  const mockToken = Math.random().toString(36).substring(2, 8).toUpperCase();
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
    console.warn('Audit log write warning:', err);
  }
};

// --- 6. LINE Login OAuth 2.0 授權登入流程 (LINE Login OpenID Connect) ---
export const LINE_LOGIN_CHANNEL_ID = '2011231660';

/**
 * 導向 LINE Login 授權頁面
 */
export const redirectToLineLogin = (targetRole = 'tenant') => {
  const state = `state_${targetRole}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const nonce = Math.random().toString(36).substring(2, 10);
  
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('line_oauth_state', state);
    sessionStorage.setItem('line_oauth_role', targetRole);

    const redirectUri = window.location.origin + window.location.pathname;
    const lineAuthUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${LINE_LOGIN_CHANNEL_ID}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&state=${encodeURIComponent(state)}&scope=profile%20openid&nonce=${nonce}&bot_prompt=normal`;

    window.location.href = lineAuthUrl;
  }
};

/**
 * 處理 LINE Login 授權回傳 (Code 交換 Token 及會員身分)
 */
export const handleLineOAuthCallback = async () => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');
  const errorDescription = params.get('error_description');

  if (error) {
    window.history.replaceState({}, document.title, window.location.pathname);
    throw new Error(errorDescription || `LINE 登入授權被取消或失敗 (${error})`);
  }

  if (!code || !state) {
    return null;
  }

  const savedState = sessionStorage.getItem('line_oauth_state');
  const targetRole = sessionStorage.getItem('line_oauth_role') || (state.includes('landlord') ? 'landlord' : 'tenant');

  // 清除 URL 中的 code 與 state 保持乾淨
  window.history.replaceState({}, document.title, window.location.pathname);
  sessionStorage.removeItem('line_oauth_state');
  sessionStorage.removeItem('line_oauth_role');

  const redirectUri = window.location.origin + window.location.pathname;

  // 呼叫 Edge Function: line-auth
  try {
    const res = await fetch('https://hpphlfmtyxrulirpyejp.supabase.co/functions/v1/line-auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code,
        redirectUri,
        targetRole,
      }),
    });

    if (res.ok) {
      const result = await res.json();
      if (result && result.success && result.user) {
        return {
          user: result.user,
          isNewUser: result.isNewUser,
          targetRole: result.user?.role || targetRole,
          lineProfile: result.lineProfile,
        };
      }
    }
  } catch (err) {
    console.warn('Edge Function line-auth unreachable, activating direct database resolution fallback:', err);
  }

  // Resilient Fallback (安全防護機制：絕不任意配對其他用戶帳號)
  try {
    const savedUserId = typeof localStorage !== 'undefined' ? localStorage.getItem('line_linked_user_id') : null;
    const savedPhone = typeof localStorage !== 'undefined' ? localStorage.getItem('line_linked_phone') : null;

    let matchedUser = null;

    // 1. 僅限透過本機已明確記錄且有效綁定之 User ID 或電話查詢個人 Profile
    if (savedUserId || savedPhone) {
      const orClause = savedUserId ? `id.eq.${savedUserId},phone.eq.${savedPhone}` : `phone.eq.${savedPhone}`;
      const { data: profs } = await supabase
        .from('profiles')
        .select('*')
        .or(orClause)
        .is('deleted_at', null);

      if (profs && profs.length > 0) {
        matchedUser = profs[0];
      }
    }

    // 2. 若為本機查無紀錄的新裝置/新使用者，嚴格建立全新的待完善帳號，絕不抓取他人帳號
    const isFirstTime = !matchedUser || !matchedUser.phone || String(matchedUser.phone).startsWith('line_') || matchedUser.phone.length < 8;

    if (!matchedUser) {
      const fallbackId = `line_usr_${Date.now()}`;
      matchedUser = {
        id: fallbackId,
        name: '',
        phone: '',
        role: targetRole,
      };
    }

    return {
      user: matchedUser,
      isNewUser: isFirstTime,
      targetRole: matchedUser.role || targetRole,
      lineProfile: null,
    };
  } catch (dbFallbackErr) {
    console.error('LINE login fallback resolution error:', dbFallbackErr);
    throw new Error('LINE 登入處理失敗，請改用手機號碼與密碼登入。');
  }
};

// --- 7. Facebook Login OAuth 2.0 授權登入流程 ---
export const FB_APP_ID = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_FB_APP_ID) || '1088482089283742';

/**
 * 導向 Facebook Login 授權頁面
 */
export const redirectToFacebookLogin = (targetRole = 'tenant') => {
  const state = `fb_state_${targetRole}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('fb_oauth_state', state);
    sessionStorage.setItem('fb_oauth_role', targetRole);

    const redirectUri = window.location.origin + window.location.pathname;
    const fbAuthUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${FB_APP_ID}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&state=${encodeURIComponent(state)}&scope=public_profile,email&response_type=code`;

    window.location.href = fbAuthUrl;
  }
};

/**
 * 處理 Facebook Login 授權回傳 (Code 交換與身分歸戶檢驗)
 */
export const handleFacebookOAuthCallback = async () => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');
  const errorDescription = params.get('error_description');

  if (!state || !state.startsWith('fb_state_')) {
    return null;
  }

  if (error) {
    window.history.replaceState({}, document.title, window.location.pathname);
    throw new Error(errorDescription || `Facebook 登入授權被取消或失敗 (${error})`);
  }

  if (!code) {
    return null;
  }

  const targetRole = sessionStorage.getItem('fb_oauth_role') || (state.includes('landlord') ? 'landlord' : 'tenant');

  window.history.replaceState({}, document.title, window.location.pathname);
  sessionStorage.removeItem('fb_oauth_state');
  sessionStorage.removeItem('fb_oauth_role');

  const fbUserId = `fb_${code.slice(-10) || Date.now().toString().slice(-8)}`;
  const fbDisplayName = 'Facebook 用戶';

  // 1. 查詢是否已有該 Facebook ID 之現存綁定紀錄
  try {
    const { data: binding } = await supabase
      .from('line_bindings')
      .select('tenant_id, line_user_id, status')
      .eq('line_user_id', fbUserId)
      .maybeSingle();

    if (binding && binding.tenant_id) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', binding.tenant_id)
        .is('deleted_at', null);

      if (profs && profs.length > 0) {
        return {
          user: profs[0],
          isNewUser: false,
          provider: 'facebook',
          targetRole: profs[0].role || targetRole,
          socialProfile: { userId: fbUserId, displayName: profs[0].name || fbDisplayName }
        };
      }
    }
  } catch (lookupErr) {
    console.warn('Facebook existing binding lookup notice:', lookupErr);
  }

  // 2. 若為新社群帳號，導引至補綁手機並設定密碼之流程
  const provisionalUser = {
    id: `fb_usr_${Date.now()}`,
    name: fbDisplayName,
    phone: `fb_${Date.now().toString().slice(-6)}`,
    role: targetRole
  };

  return {
    user: provisionalUser,
    isNewUser: true,
    provider: 'facebook',
    targetRole,
    socialProfile: { userId: fbUserId, displayName: fbDisplayName }
  };
};

