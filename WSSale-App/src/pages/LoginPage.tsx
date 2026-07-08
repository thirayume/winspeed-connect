import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/auth-store';
import { getMe, lineLoginUrl, linkLineLogin, login as apiLogin, setToken } from '../services/api';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [lineLinkToken, setLineLinkToken] = useState('');
  const [lineName, setLineName] = useState('');
  const authLogin = useAuthStore(s => s.login);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const lineToken = hash.get('line_token');
    const nextLineLinkToken = hash.get('line_link_token');
    const lineError = hash.get('line_error');
    if (!lineToken && !nextLineLinkToken && !lineError) return;

    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    if (lineToken) {
      setToken(lineToken);
      window.setTimeout(() => setLoading(true), 0);
      getMe()
        .then(user => authLogin(lineToken, user))
        .catch(err => window.setTimeout(() => setError((err as Error).message || 'LINE Login ไม่สำเร็จ'), 0))
        .finally(() => window.setTimeout(() => setLoading(false), 0));
      return;
    }

    if (nextLineLinkToken) {
      const nextLineName = hash.get('line_name') || '';
      window.setTimeout(() => {
        setLineLinkToken(nextLineLinkToken);
        setLineName(nextLineName);
        setError('');
      }, 0);
      return;
    }

    const nextError = lineError === 'line_not_bound'
      ? 'LINE นี้ยังไม่ได้ผูกกับผู้ใช้ในระบบ กรุณากรอก username/password ของคุณเพื่อผูกครั้งแรก'
      : (lineError || 'LINE Login ไม่สำเร็จ');
    if (lineError === 'line_not_bound') {
      window.setTimeout(() => setError(nextError), 0);
    } else {
      window.setTimeout(() => setError(nextError), 0);
    }
  }, [authLogin]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { accessToken, user } = lineLinkToken
        ? await linkLineLogin(username, password, lineLinkToken)
        : await apiLogin(username, password);
      authLogin(accessToken, user);
    } catch (err: unknown) {
      setError((err as Error).message || (lineLinkToken
        ? 'ผูก LINE ไม่สำเร็จ กรุณาตรวจ username/password หรือติดต่อ Admin'
        : 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#F1EFE8' }}>
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        {/* Logo area */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-3"
               style={{ background: '#0C447C' }}>
            <span className="text-white text-2xl font-bold">WF</span>
          </div>
          <h1 className="text-xl font-bold" style={{ color: '#0C447C' }}>WS-Sale-App</h1>
          <p className="text-sm text-gray-500 mt-1">World Fertilizer Co., Ltd.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {lineLinkToken && (
            <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              {`ยืนยันผู้ใช้เพื่อผูก LINE${lineName ? ` (${lineName})` : ''}`}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อผู้ใช้</label>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
              style={{ '--tw-ring-color': '#0C447C' } as React.CSSProperties}
              placeholder="username"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">รหัสผ่าน</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-white font-semibold text-sm transition-opacity disabled:opacity-60"
            style={{ background: '#0C447C' }}
          >
            {loading ? 'กำลังเข้าสู่ระบบ...' : (lineLinkToken ? 'ยืนยันและผูก LINE' : 'เข้าสู่ระบบ')}
          </button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-[11px] font-semibold text-gray-400">หรือ</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => { window.location.href = lineLoginUrl(); }}
            className="w-full py-2.5 rounded-lg bg-[#06C755] text-white font-semibold text-sm transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            Login with LINE
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-6">
          ติดต่อผู้ดูแลระบบหากลืมรหัสผ่าน
        </p>
      </div>
    </div>
  );
}
