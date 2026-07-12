import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { getToken, req } from '../../services/api';
import { Camera, Lock, User, Save, Upload, Info } from 'lucide-react';

export default function ProfilePage() {
  const { user, login } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'info' | 'security'>('info');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Info Tab State
  const [address, setAddress] = useState(user?.address || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [email, setEmail] = useState(user?.email || '');
  const [idCardNo, setIdCardNo] = useState(user?.idCardNo || '');
  const [taxId, setTaxId] = useState(user?.taxId || '');
  
  // Security Tab State
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Signature state
  const [sigFile, setSigFile] = useState<File | null>(null);
  const [sigPreview, setSigPreview] = useState<string | null>(
    user?.signatureFile ? `${import.meta.env.VITE_API_URL}/uploads/${user.signatureFile}` : null
  );

  useEffect(() => {
    // Refresh user info
    req<any>('/auth/me').then(u => {
      login(getToken() || '', u);
      setAddress(u.address || '');
      setPhone(u.phone || '');
      setEmail(u.email || '');
      setIdCardNo(u.idCardNo || '');
      setTaxId(u.taxId || '');
      if (u.signatureFile) {
        setSigPreview(`${import.meta.env.VITE_API_URL || ''}/uploads/${u.signatureFile}`);
      }
    }).catch(() => {});
  }, []);

  const handleInfoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await req('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ address, phone, email, idCardNo, taxId }),
      });
      
      if (sigFile) {
        const formData = new FormData();
        formData.append('signature', sigFile);
        const token = getToken();
        const res = await fetch(`${import.meta.env.VITE_API_URL || '/api'}/auth/profile/signature`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData
        });
        if (!res.ok) throw new Error('อัพโหลดลายเซ็นต์ไม่สำเร็จ');
      }

      setSuccess('บันทึกข้อมูลเรียบร้อยแล้ว');
      // Refresh user
      const updatedUser = await req<any>('/auth/me');
      login(getToken() || '', updatedUser);
    } catch (err: any) {
      setError(err.message || 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('รหัสผ่านใหม่ไม่ตรงกัน');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await req('/auth/profile/password', {
        method: 'PUT',
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      setSuccess('เปลี่ยนรหัสผ่านเรียบร้อยแล้ว');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err.message || 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSigFile(file);
      setSigPreview(URL.createObjectURL(file));
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center space-x-3 mb-8">
        <User className="h-8 w-8 text-primary" />
        <h1 className="text-2xl font-bold text-gray-900">โปรไฟล์ของฉัน</h1>
      </div>

      <div className="flex border-b border-gray-200">
        <button
          className={`pb-4 px-4 text-sm font-medium ${activeTab === 'info' ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-gray-700'}`}
          onClick={() => { setActiveTab('info'); setError(''); setSuccess(''); }}
        >
          ข้อมูลส่วนตัว
        </button>
        <button
          className={`pb-4 px-4 text-sm font-medium ${activeTab === 'security' ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-gray-700'}`}
          onClick={() => { setActiveTab('security'); setError(''); setSuccess(''); }}
        >
          ความปลอดภัย
        </button>
      </div>

      {error && <div className="p-4 bg-red-50 text-red-600 rounded-lg">{error}</div>}
      {success && <div className="p-4 bg-green-50 text-green-600 rounded-lg">{success}</div>}

      {activeTab === 'info' && (
        <form onSubmit={handleInfoSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">ชื่อ-นามสกุล</label>
              <input type="text" value={user?.displayName || ''} disabled className="w-full px-3 py-2 border rounded-md bg-gray-50 text-gray-500" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">ชื่อผู้ใช้ (Username)</label>
              <input type="text" value={user?.username || ''} disabled className="w-full px-3 py-2 border rounded-md bg-gray-50 text-gray-500" />
            </div>
            
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">ที่อยู่</label>
              <textarea value={address} onChange={e => setAddress(e.target.value)} rows={3} className="w-full px-3 py-2 border rounded-md focus:ring-primary focus:border-primary" />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">เบอร์โทรศัพท์</label>
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="w-full px-3 py-2 border rounded-md focus:ring-primary focus:border-primary" />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">อีเมล</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-3 py-2 border rounded-md focus:ring-primary focus:border-primary" />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">เลขประจำตัวประชาชน</label>
              <input type="text" value={idCardNo} onChange={e => setIdCardNo(e.target.value)} className="w-full px-3 py-2 border rounded-md focus:ring-primary focus:border-primary" />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-sm font-medium text-gray-700">เลขประจำตัวผู้เสียภาษี</label>
                <button type="button" onClick={() => setTaxId(idCardNo)} className="text-xs text-primary hover:underline">
                  ใช้เลขเดียวกับบัตรประชาชน
                </button>
              </div>
              <input type="text" value={taxId} onChange={e => setTaxId(e.target.value)} className="w-full px-3 py-2 border rounded-md focus:ring-primary focus:border-primary" />
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">ลายเซ็นต์</label>
              <div className="flex items-center space-x-6">
                <div className="h-32 w-64 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center bg-gray-50 overflow-hidden relative group">
                  {sigPreview ? (
                    <img src={sigPreview} alt="Signature" className="object-contain h-full w-full" />
                  ) : (
                    <div className="text-center text-gray-400">
                      <Upload className="mx-auto h-8 w-8 mb-2" />
                      <span className="text-xs">ยังไม่มีลายเซ็นต์</span>
                    </div>
                  )}
                </div>
                <div>
                  <input type="file" id="sig-upload" accept="image/*" className="hidden" onChange={handleFileChange} />
                  <label htmlFor="sig-upload" className="cursor-pointer px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
                    เลือกไฟล์ลายเซ็นต์
                  </label>
                  <p className="mt-2 text-xs text-gray-500">แนะนำ: ภาพพื้นหลังโปร่งใส (.png) ขนาดไม่เกิน 5MB</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-6">
            <button type="submit" disabled={loading} className="px-6 py-2 bg-primary text-white font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center">
              {loading ? 'กำลังบันทึก...' : <><Save className="w-4 h-4 mr-2" /> บันทึกข้อมูล</>}
            </button>
          </div>
        </form>
      )}

      {activeTab === 'security' && (
        <form onSubmit={handlePasswordSubmit} className="space-y-6 max-w-md">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">รหัสผ่านปัจจุบัน</label>
              <input type="password" required value={oldPassword} onChange={e => setOldPassword(e.target.value)} className="w-full px-3 py-2 border rounded-md focus:ring-primary focus:border-primary" />
            </div>
            
            <div className="space-y-2 pt-4">
              <label className="text-sm font-medium text-gray-700">รหัสผ่านใหม่</label>
              <input type="password" required value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full px-3 py-2 border rounded-md focus:ring-primary focus:border-primary" />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">ยืนยันรหัสผ่านใหม่</label>
              <input type="password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full px-3 py-2 border rounded-md focus:ring-primary focus:border-primary" />
            </div>
          </div>

          <div className="pt-4">
            <button type="submit" disabled={loading || !oldPassword || !newPassword || !confirmPassword} className="w-full px-4 py-2 bg-primary text-white font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center">
              {loading ? 'กำลังเปลี่ยนรหัสผ่าน...' : <><Lock className="w-4 h-4 mr-2" /> เปลี่ยนรหัสผ่าน</>}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
