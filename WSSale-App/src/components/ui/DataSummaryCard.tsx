import { ReactNode } from 'react';

type DataSummaryCardProps = {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: ReactNode;
  colorClass: string;
};

export const DataSummaryCard = ({ title, value, subtitle, icon, colorClass }: DataSummaryCardProps) => {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
      <div className={`h-12 w-12 rounded-full flex items-center justify-center shrink-0 ${colorClass}`}>
        {icon}
      </div>
      <div>
        <p className="text-sm text-gray-500 font-medium">{title}</p>
        <h3 className="text-2xl font-bold text-gray-800">{value}</h3>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
};
