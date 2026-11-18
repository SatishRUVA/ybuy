import { useState } from 'react';
import { DateRangePicker } from '@/main-site/components/date-range-picker';

export function RentalCalendarHarness() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  return <DateRangePicker
    presentation="listing"
    startDate={startDate}
    endDate={endDate}
    maximumDate="2027-01-03"
    blockedDates={new Set(['2026-11-20'])}
    onChange={(start, end) => { setStartDate(start); setEndDate(end); }}
  />;
}
