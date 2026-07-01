import { ReactNode } from 'react';

type DataSummaryCardProps = {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: ReactNode;
  colorClass: string;
  className?: string;
};

export const DataSummaryCard = ({ title, value, subtitle, icon, colorClass, className = '' }: DataSummaryCardProps) => {
  return (
    <div className={`bg-white rounded-xl border border-gray-100 shadow-sm p-2 sm:p-4 flex flex-col sm:flex-row items-center sm:items-start md:items-center gap-1 sm:gap-4 hover:shadow-md transition-shadow justify-center text-center sm:text-left ${className}`}>
      <div className={`h-8 w-8 sm:h-12 sm:w-12 rounded-full flex items-center justify-center shrink-0 [&>svg]:w-4 [&>svg]:h-4 sm:[&>svg]:w-6 sm:[&>svg]:h-6 ${colorClass}`}>
        {icon}
      </div>
      <div className="flex flex-col items-center sm:items-start min-w-0">
        <p className="text-[10px] sm:text-sm text-gray-500 font-medium leading-tight truncate w-full">{title}</p>
        <h3 className="text-lg sm:text-2xl font-bold text-gray-800 leading-tight">{value}</h3>
        {subtitle && <p className="text-[9px] sm:text-xs text-gray-400 mt-0.5 leading-tight truncate w-full">{subtitle}</p>}
      </div>
    </div>
  );
};
