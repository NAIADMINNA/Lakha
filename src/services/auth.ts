import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
];

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));

// Flag to indicate if we are in the middle of a sign-in flow.
let isSigningIn = false;
// Cache the access token in memory ONLY (never in localStorage or sessionStorage).
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: (user: User | null) => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure(user);
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure(null);
    }
  });
};

export const isInAppWebView = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /\b(Line\/|FBAN|FBAV|Instagram|MicroMessenger)\b/i.test(ua);
};

export const openInExternalBrowser = (): string => {
  if (typeof window === 'undefined') return '';
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('openExternalBrowser', '1');
    const target = url.toString();
    window.location.href = target;
    return target;
  } catch {
    return window.location.href;
  }
};

export interface GoogleSignInResult {
  user: User;
  accessToken: string;
}

export const googleSignIn = async (): Promise<GoogleSignInResult | null> => {
  if (isSigningIn) return null;

  // Prevent storage-partitioned WebView crash ("Unable to process request due to missing initial state")
  // inside LINE / Facebook / Instagram In-App Browsers on iOS & Android
  if (isInAppWebView()) {
    openInExternalBrowser();
    throw new Error(
      'เบราว์เซอร์ภายในแอป LINE ไม่รองรับการล็อกอิน Google โดยตรง (เนื่องจากระบบความปลอดภัยของ iOS/Google บล็อก sessionStorage ในแอปแชท) — ระบบได้ส่งคำสั่งเปิดใน Safari/Chrome ให้แล้ว หรือกดปุ่มแชร์/เมนู (⋯) มุมขวาล่าง แล้วเลือก "เปิดในเบราว์เซอร์เริ่มต้น (Open in Safari/Chrome)" ครับ'
    );
  }

  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('ไม่สามารถดึง Access Token สำหรับ Google Sheets ได้ กรุณาลองใหม่อีกครั้ง');
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: unknown) {
    const firebaseErr = error as { code?: string; message?: string };
    const code = firebaseErr?.code || '';

    // User closed the popup or clicked the button twice — treat as normal cancellation, not an error
    if (
      code === 'auth/popup-closed-by-user' ||
      code === 'auth/cancelled-popup-request'
    ) {
      return null;
    }

    if (code === 'auth/popup-blocked') {
      throw new Error(
        'เบราว์เซอร์บล็อกหน้าต่างป๊อปอัป กรุณาอนุญาตป๊อปอัป (Allow Pop-ups) หรือเปิดลิงก์นี้ใน Safari / Chrome โดยตรงแล้วลองใหม่อีกครั้ง'
      );
    }

    if (code === 'auth/unauthorized-domain') {
      const host = typeof window !== 'undefined' ? window.location.hostname : '';
      throw new Error(
        `โดเมน "${host}" ยังไม่ได้เพิ่มในรายการอนุญาตของ Firebase Auth (ไม่จำเป็นต้องล็อกอิน Google หากเชื่อมต่อผ่านลิงก์ Google Apps Script แล้ว)`
      );
    }

    throw new Error(
      firebaseErr?.message || 'ไม่สามารถเข้าสู่ระบบด้วย Google ได้ กรุณาลองใหม่อีกครั้ง'
    );
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};
