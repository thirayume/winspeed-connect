import { useEffect, useState, useMemo } from 'react';
import { Search, Edit2, Save, X, RefreshCw, Truck, Trash2, Users, UserCheck, ArrowUpDown, Phone } from 'lucide-react';
import { fetchCustomers, updateCustomer } from '../../services/api';
import { DataSummaryCard } from '../ui/DataSummaryCard';
import { DeleteConfirmModal } from '../ui/DeleteConfirmModal';
import type { EMCust } from '../../types';

export const CustomersManager = ({ onViewTrucks }: { onViewTrucks?: (custName: string) => void }) => {
  const [customers, setCustomers] = useState<EMCust[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<EMCust>>({});
  const [saving, setSaving] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Pagination & Sorting
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 30;
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'CustID', direction: 'asc' });

  async function loadCustomers() {
    setLoading(true);
    try {
      const data = await fetchCustomers();
      // Filter out deleted/inactive if we want to hide them, but the API might already filter them or we just show them as inactive.
      // Assuming 'Inactive' property exists if added to backend, for now just show all.
      setCustomers(data.filter(c => c.Inactive !== 'I')); 
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadCustomers();
  }, []);

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => 
      c.CustID.toLowerCase().includes(searchQuery.toLowerCase()) || 
      c.CustName.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [customers, searchQuery]);

  const sortedCustomers = useMemo(() => {
    const sortableItems = [...filteredCustomers];
    if (sortConfig.key) {
      sortableItems.sort((a, b) => {
        let aVal: any = a[sortConfig.key as keyof EMCust] || '';
        let bVal: any = b[sortConfig.key as keyof EMCust] || '';
        
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [filteredCustomers, sortConfig]);

  const totalPages = Math.ceil(sortedCustomers.length / itemsPerPage);
  const paginatedCustomers = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedCustomers.slice(start, start + itemsPerPage);
  }, [sortedCustomers, currentPage]);

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const handleEdit = (cust: EMCust) => {
    setEditingId(cust.CustID);
    setEditForm({ ...cust });
  };

  const handleSave = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await updateCustomer(editingId, editForm);
      setCustomers(prev => prev.map(c => c.CustID === editingId ? { ...c, ...editForm } as EMCust : c));
      setEditingId(null);
    } catch (err) {
      alert('บันทึกไม่สำเร็จ');
      console.error(err);
    }
    setSaving(false);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    setDeleteLoading(true);
    try {
      // Calling the delete API we just made
      await fetch(`http://localhost:3000/api/master/customers/${deletingId}`, { 
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('wssale_token')}` }
      });
      // Remove from list
      setCustomers(prev => prev.filter(c => c.CustID !== deletingId));
      setDeletingId(null);
    } catch (err) {
      alert('ไม่สามารถลบข้อมูลได้');
      console.error(err);
    }
    setDeleteLoading(false);
  };

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
        <DataSummaryCard
          title="ลูกค้าทั้งหมด"
          value={customers.length.toLocaleString()}
          icon={<Users size={24} />}
          colorClass="bg-blue-100 text-blue-600"
        />
        <DataSummaryCard
          title="ค้นพบ"
          value={filteredCustomers.length.toLocaleString()}
          icon={<Search size={24} />}
          colorClass="bg-emerald-100 text-emerald-600"
        />
        <DataSummaryCard
          title="ติดต่อได้ (มีเบอร์)"
          value={customers.filter(c => c.Tel && c.Tel.trim().length > 0).length.toLocaleString()}
          icon={<Phone size={24} />}
          colorClass="bg-orange-100 text-orange-600"
        />
      </div>

      <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden relative">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-4 bg-gray-50/50">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="ค้นหารหัส หรือ ชื่อลูกค้า..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C] focus:border-transparent"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
          </div>
          <button onClick={loadCustomers} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 sticky top-0 z-10 text-gray-600 font-semibold text-xs uppercase tracking-wider">
              <tr>
                <th className="px-6 py-4 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => requestSort('CustID')}>
                  <div className="flex items-center gap-1">รหัสลูกค้า <ArrowUpDown size={12} className={sortConfig.key === 'CustID' ? 'text-[#0C447C] font-bold' : 'text-gray-400'} /></div>
                </th>
                <th className="px-6 py-4 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => requestSort('CustName')}>
                  <div className="flex items-center gap-1">ชื่อลูกค้า <ArrowUpDown size={12} className={sortConfig.key === 'CustName' ? 'text-[#0C447C] font-bold' : 'text-gray-400'} /></div>
                </th>
                <th className="px-6 py-4 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => requestSort('Tel')}>
                  <div className="flex items-center gap-1">โทรศัพท์ <ArrowUpDown size={12} className={sortConfig.key === 'Tel' ? 'text-[#0C447C] font-bold' : 'text-gray-400'} /></div>
                </th>
                <th className="px-6 py-4 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => requestSort('Remark')}>
                  <div className="flex items-center gap-1">หมายเหตุเพิ่มเติม <ArrowUpDown size={12} className={sortConfig.key === 'Remark' ? 'text-[#0C447C] font-bold' : 'text-gray-400'} /></div>
                </th>
                <th className="px-6 py-4 border-b border-gray-100 text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center justify-center text-[#0C447C]">
                      <RefreshCw size={32} className="animate-spin mb-4 opacity-50" />
                      <p className="text-sm font-medium animate-pulse opacity-70">กำลังโหลดข้อมูลลูกค้า...</p>
                    </div>
                  </td>
                </tr>
              ) : paginatedCustomers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                    <Users size={32} className="mx-auto mb-3 opacity-30" />
                    <p>ไม่พบข้อมูลลูกค้า</p>
                  </td>
                </tr>
              ) : (
                paginatedCustomers.map(cust => {
                  const isEditing = editingId === cust.CustID;
                  
                  return (
                    <tr key={cust.CustID} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-3 font-medium text-gray-800">{cust.CustID}</td>
                      <td className="px-6 py-3">
                        {isEditing ? (
                          <input 
                            type="text" 
                            value={editForm.CustName || ''} 
                            onChange={e => setEditForm({ ...editForm, CustName: e.target.value })}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-[#0C447C]"
                          />
                        ) : cust.CustName}
                      </td>
                      <td className="px-6 py-3 text-gray-600">
                        {isEditing ? (
                          <input 
                            type="text" 
                            value={editForm.Tel || ''} 
                            onChange={e => setEditForm({ ...editForm, Tel: e.target.value })}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-[#0C447C]"
                          />
                        ) : cust.Tel || '-'}
                      </td>
                      <td className="px-6 py-3 text-gray-600">
                        {isEditing ? (
                          <input 
                            type="text" 
                            placeholder="หมายเหตุ..."
                            value={editForm.Remark || ''} 
                            onChange={e => setEditForm({ ...editForm, Remark: e.target.value })}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-[#0C447C]"
                          />
                        ) : cust.Remark || '-'}
                      </td>
                      <td className="px-6 py-3 text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => setEditingId(null)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded">
                              <X size={16} />
                            </button>
                            <button onClick={handleSave} disabled={saving} className="p-1.5 text-white bg-[#0C447C] hover:bg-[#0a3866] rounded disabled:opacity-50 flex items-center gap-1 text-xs">
                              {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />} บันทึก
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            {onViewTrucks && (
                              <button onClick={() => onViewTrucks(cust.CustName)} className="p-1.5 text-gray-400 hover:text-[#0C447C] hover:bg-blue-50 rounded-lg transition-colors inline-flex items-center justify-center" title="ดูประวัติรถบรรทุกของลูกค้านี้">
                                <Truck size={16} />
                              </button>
                            )}
                            <button onClick={() => handleEdit(cust)} className="p-1.5 text-gray-400 hover:text-[#0C447C] hover:bg-blue-50 rounded-lg transition-colors inline-flex items-center justify-center" title="แก้ไขข้อมูล">
                              <Edit2 size={16} />
                            </button>
                            <button onClick={() => setDeletingId(cust.CustID)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors inline-flex items-center justify-center" title="ปิดสถานะ (Inactive)">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-3 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
            <span className="text-sm text-gray-500">
              แสดง {((currentPage - 1) * itemsPerPage) + 1} ถึง {Math.min(currentPage * itemsPerPage, filteredCustomers.length)} จาก {filteredCustomers.length}
            </span>
            <div className="flex gap-1">
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 bg-white border border-gray-200 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                ก่อนหน้า
              </button>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 bg-white border border-gray-200 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                ถัดไป
              </button>
            </div>
          </div>
        )}
      </div>

      <DeleteConfirmModal
        isOpen={!!deletingId}
        onClose={() => setDeletingId(null)}
        onConfirm={handleDeleteConfirm}
        title="ยืนยันการลบลูกค้า"
        itemName={customers.find(c => c.CustID === deletingId)?.CustName || ''}
        loading={deleteLoading}
      />
    </div>
  );
};
