import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { UserRole } from '../../types';

export type NavItem = {
  key: string;
  label: string;
  sub: string;
  icon: LucideIcon;
  roles?: UserRole[];
  badge?: boolean;
};

export type NavGroup = {
  groupLabel: string;
  icon?: LucideIcon;
  color?: string;
  items: NavItem[];
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  groups: NavGroup[];
  activePortal: string;
  userRole?: UserRole;
  pendingUnlocks: number;
  onNavigate: (key: string) => void;
};

export function MobileDrawer({ isOpen, onClose, groups, activePortal, userRole, pendingUnlocks, onNavigate }: Props) {
  const backdropRef = useRef<HTMLDivElement>(null);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelect = (key: string) => {
    onNavigate(key);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      {/* Backdrop */}
      <div
        ref={backdropRef}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm mobile-drawer-backdrop"
        onClick={onClose}
      />

      {/* Bottom Sheet */}
      <div className="absolute bottom-0 left-0 right-0 mobile-drawer-sheet bg-white rounded-t-3xl shadow-2xl flex flex-col safe-bottom" style={{ maxHeight: '80vh' }}>
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-800">เมนูทั้งหมด</h2>
          <button
            onClick={onClose}
            className="p-2 -mr-2 rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Menu groups */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 no-scrollbar">
          {groups.map(group => {
            const visibleItems = group.items.filter(
              n => !n.roles || (userRole && n.roles.includes(userRole))
            );
            if (visibleItems.length === 0) return null;

            return (
              <div key={group.groupLabel}>
                <div className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-1 mb-2 ${group.color || 'text-gray-400'}`}>
                  {group.icon && <group.icon size={14} />}
                  <span>{group.groupLabel}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {visibleItems.map(n => {
                    const Icon = n.icon;
                    const isActive = activePortal === n.key;
                    return (
                      <button
                        key={n.key}
                        onClick={() => handleSelect(n.key)}
                        className={`relative flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-center transition-all ${
                          isActive
                            ? 'bg-[#0C447C] text-white shadow-md'
                            : 'bg-gray-50 text-gray-600 hover:bg-gray-100 active:scale-95'
                        }`}
                      >
                        <Icon size={20} className={isActive ? 'text-white' : (group.color || 'text-gray-500')} />
                        <span className="text-[11px] font-semibold leading-tight">{n.label}</span>
                        {n.badge && pendingUnlocks > 0 && (
                          <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white">
                            {pendingUnlocks}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
