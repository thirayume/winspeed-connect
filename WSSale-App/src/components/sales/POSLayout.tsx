import React, { useState, useMemo } from 'react';
import { 
  Search, 
  Plus, 
  Minus, 
  Trash2, 
  ShoppingCart, 
  ChevronRight,
  Filter,
  Package,
  CircleCheck,
  TrendingUp,
  Clock
} from 'lucide-react';
import { Button, Card, Badge, cn } from '../ui/Base';
import type { EMGood, SOLine } from '../types';

interface POSLayoutProps {
  items: EMGood[];
  lines: SOLine[];
  onAddLine: (item: EMGood) => void;
  onUpdateQty: (goodId: string, qty: number) => void;
  onRemoveLine: (goodId: string) => void;
  onConfirm: () => void;
  isSubmitting?: boolean;
}

export const POSLayout = ({ 
  items, 
  lines, 
  onAddLine, 
  onUpdateQty, 
  onRemoveLine, 
  onConfirm,
  isSubmitting 
}: POSLayoutProps) => {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const cats = new Set(items.map(i => i.Category).filter(Boolean));
    return Array.from(cats) as string[];
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchesSearch = (item.GoodName1 || item.GoodName || '').toLowerCase().includes(search.toLowerCase()) || 
                           item.GoodID.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = !selectedCategory || item.Category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [items, search, selectedCategory]);

  const total = lines.reduce((sum, line) => sum + (line.GoodQty1 * line.GoodPrice1), 0);

  // Generate a placeholder image URL based on item name
  const getPlaceholderImage = (name: string) => {
    const seed = encodeURIComponent(name);
    return `https://api.dicebear.com/7.x/identicon/svg?seed=${seed}&backgroundColor=f1f5f9`;
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-slate-50/30">
      {/* Left Side: Items & Categories */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0 border-r border-border">
        {/* Search & Categories Bar */}
        <div className="p-4 space-y-4 bg-white border-b border-border shadow-sm z-10">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search items by name or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm"
            />
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            <Button
              variant={selectedCategory === null ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedCategory(null)}
              className="rounded-full px-4 h-9 whitespace-nowrap"
            >
              All Items
            </Button>
            {categories.map(cat => (
              <Button
                key={cat}
                variant={selectedCategory === cat ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedCategory(cat)}
                className="rounded-full px-4 h-9 whitespace-nowrap"
              >
                {cat}
              </Button>
            ))}
          </div>
        </div>

        {/* Items Grid */}
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          <div className="grid grid-cols-3 gap-3">
            {filteredItems.map(item => {
              const inCart = lines.find(l => l.GoodID === item.GoodID);
              const qty = inCart?.GoodQty1 || 0;

              return (
                <Card 
                  key={item.GoodID}
                  onClick={() => onAddLine(item)}
                  className={cn(
                    "relative flex flex-col p-4 h-36 hover:shadow-lg transition-all cursor-pointer group border-border/50",
                    qty > 0 ? "ring-2 ring-primary border-primary bg-primary/5" : "bg-white"
                  )}
                >
                  <div className="flex flex-col h-full">
                    <div className="text-[11px] font-black text-foreground line-clamp-3 leading-tight mb-1 group-hover:text-primary transition-colors">
                      {item.GoodName || item.GoodName1}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono mb-2">
                      {item.GoodID}
                    </div>
                    
                    <div className="mt-auto flex items-center justify-between">
                      <div className="text-sm font-black text-primary tabular">
                        ฿{item.GoodPrice1?.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">
                        <Package size={10} />
                        {item.StockQty}
                      </div>
                    </div>
                  </div>

                  {qty > 0 && (
                    <div className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold shadow-sm animate-in zoom-in">
                      {qty}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right Side: Cart Summary */}
      <div className="w-72 lg:w-80 flex flex-col bg-white shrink-0">
        <div className="p-4 border-b border-border bg-slate-50/50">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <ShoppingCart size={20} className="text-primary" />
              Order Summary
            </h2>
            <Badge variant="secondary" className="rounded-lg">{lines.length} items</Badge>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
          {lines.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-40">
              <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                <ShoppingCart size={32} />
              </div>
              <p className="text-sm font-medium">Your cart is empty</p>
              <p className="text-xs mt-1 text-muted-foreground">Tap items on the left to add them to your order.</p>
            </div>
          ) : (
            lines.map((line) => {
              const item = items.find(i => i.GoodID === line.GoodID);
              const displayName = item?.GoodName || item?.GoodName1 || line.GoodID;
              return (
                <div key={line.GoodID} className="flex flex-col gap-2 p-3 rounded-xl border border-border bg-white shadow-sm animate-in slide-in-from-right-4">
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold truncate pr-2">{displayName}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">฿{line.GoodPrice1.toLocaleString()} / unit</div>
                    </div>
                    <button 
                      onClick={() => onRemoveLine(line.GoodID)}
                      className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/5 rounded-lg transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  
                  <div className="flex items-center justify-between mt-1">
                    <div className="flex items-center bg-slate-100 rounded-lg p-1">
                      <button 
                        onClick={() => onUpdateQty(line.GoodID, line.GoodQty1 - 1)}
                        className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-white hover:shadow-sm text-foreground transition-all"
                      >
                        <Minus size={14} />
                      </button>
                      <input 
                        type="number" 
                        value={line.GoodQty1}
                        onChange={(e) => onUpdateQty(line.GoodID, Number(e.target.value))}
                        className="w-12 text-center bg-transparent text-sm font-bold tabular outline-none"
                      />
                      <button 
                        onClick={() => onUpdateQty(line.GoodID, line.GoodQty1 + 1)}
                        className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-white hover:shadow-sm text-foreground transition-all"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <div className="text-sm font-black text-foreground tabular">
                      ฿{(line.GoodQty1 * line.GoodPrice1).toLocaleString()}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Bottom Actions */}
        <div className="p-6 border-t border-border bg-slate-50/50 space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular">฿{total.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-lg font-black text-foreground">
              <span>Order Total</span>
              <span className="tabular text-primary">฿{total.toLocaleString()}</span>
            </div>
          </div>

          <Button 
            className="w-full h-12 text-base font-bold rounded-xl bg-primary text-primary-foreground hover:shadow-lg transition-all gap-2"
            disabled={lines.length === 0 || isSubmitting}
            onClick={onConfirm}
          >
            {isSubmitting ? (
              <Clock className="animate-spin" size={20} />
            ) : (
              <CircleCheck size={20} />
            )}
            {isSubmitting ? "Processing..." : "Create Sales Order"}
          </Button>
        </div>
      </div>
    </div>
  );
};
