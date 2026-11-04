import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Surface } from '@/main-site/components/ui';
import { fieldClass, textareaClass } from '@/main-site/components/form-classes';
import { addDaysIso, todayIso } from '@/lib/geo';
import { parseCustomerIds } from '@/lib/customer-ids';
import { investigateCustomers, type InvestigationArgs } from '@/admin/api';
import { usePagedQuery, fmtDate } from '@/main-site/components/operations/query-utils';
import { PageHeader, PagedTable } from '@/main-site/components/operations/shared';

function InvestigationResults({ args }: { args: InvestigationArgs }) {
  const query = usePagedQuery((limit, offset) => investigateCustomers(args, limit, offset), [args]);
  return <PagedTable query={query} rowKey={(row) => row.customer_id}
    emptyTitle="No investigation results" emptyDescription="Submit a Customer ID batch to inspect available records."
    columns={[
      { header: 'Customer ID', cell: (row) => <span className="font-mono text-xs break-all">{row.customer_id || '(empty)'}</span> },
      { header: 'Lookup', cell: (row) => <Badge tone={row.result_status === 'found' ? 'neutral' : 'warning'}>{row.result_status}</Badge> },
      { header: 'Current self-reported area', cell: (row) => row.result_status === 'found'
        ? <div className="text-sm"><p>{[row.country_code,row.state_region_code].filter(Boolean).join(' / ')||'Not provided'}</p>
          {row.location_updated_at&&<p className="text-xs text-sec">Updated: {fmtDate(row.location_updated_at)}</p>}</div>
        : <span className="text-sec">Not available</span> },
      { header: 'Review indicators', cell: (row) => row.result_status === 'found'
        ? <div className="text-sm space-y-1"><p>{row.failed_payments} failed payment records</p><p>{row.cancellations} cancelled bookings</p><p>{row.unresolved_disputes} unresolved disputes</p></div>
        : <span className="text-sec">{row.result_status === 'invalid' ? 'Expected YB- plus ten digits.' : 'No current customer matches this ID.'}</span> },
      { header: 'Underlying records', cell: (row) => row.event_count > 0
        ? <details className="max-w-lg"><summary className="cursor-pointer text-accent font-semibold">{row.event_count} records; view newest 20</summary>
          <ul className="mt-2 space-y-3">{row.events.map((event) => <li key={`${event.kind}:${event.record_id}`} className="text-xs text-sec break-all">
            <p className="font-semibold text-main">{event.kind.replace(/_/g,' ')}: {event.status}</p>
            <p>Created: {fmtDate(event.created_at)}</p><p>Reference: {event.record_id}</p>
            {event.detail.booking_id && <p>Booking: {event.detail.booking_id}</p>}
            {event.detail.role && <p>Role: {event.detail.role}</p>}
            {event.detail.amount != null && <p>Amount: {event.detail.amount} {event.detail.currency?.toUpperCase()}</p>}
            {event.detail.category && <p>Category: {event.detail.category}</p>}
          </li>)}</ul></details>
        : <span className="text-sec">No recorded events in this period.</span> },
    ]} />;
}

export function CustomerInvestigationsSection() {
  const [input, setInput] = useState('');
  const [from, setFrom] = useState(addDaysIso(todayIso(), -30));
  const [to, setTo] = useState(todayIso());
  const [reason, setReason] = useState('');
  const [country, setCountry] = useState('');
  const [region, setRegion] = useState('');
  const [groupBy, setGroupBy] = useState<'input' | 'country' | 'region'>('input');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<InvestigationArgs | null>(null);

  async function importCsv(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      if (file.size > 65536) throw new Error('CSV must be at most 64 KB.');
      const parsed = parseCustomerIds(await file.text(), true);
      setInput(parsed.identifiers.join('\n'));
      setNotice(`Imported ${parsed.identifiers.length} distinct identifiers; ${parsed.duplicates} duplicates removed; ${parsed.invalid.length} invalid identifiers retained for reporting.`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not read that CSV file.');
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const parsed = parseCustomerIds(input);
      if (!from || !to || to < from) throw new Error('Choose a valid date range.');
      setNotice(`${parsed.identifiers.length} distinct identifiers; ${parsed.duplicates} duplicate entries removed; ${parsed.invalid.length} invalid identifiers will be reported.`);
      setSubmitted({ identifiers: parsed.identifiers, from: `${from}T00:00:00.000Z`,
        to: `${addDaysIso(to,1)}T00:00:00.000Z`, reason,
        country: country.trim()||null,region: region.trim()||null,groupBy });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not validate the investigation.');
    }
  }

  return <>
    <PageHeader title="Customer investigations" subtitle="Private, audited review of available records. Indicators are not fraud verdicts and never automatically restrict an account." />
    <Alert tone="info" className="mb-4">Results show current states of records created in the selected UTC period, not historical state transitions. Area filters use current, optional self-reported profile geography, not proof of location or fraud. No continuous location history, chargeback or shared device/payment identifiers are collected; no cross-border score is inferred. Invalid and unknown IDs remain visible regardless of area filters.</Alert>
    <Surface className="p-4 mb-4"><form className="space-y-4" onSubmit={submit}>
      <label className="block text-sm font-semibold">Customer IDs
        <textarea required rows={4} maxLength={65536} className={textareaClass('mt-1 font-mono')} value={input} onChange={(event) => setInput(event.target.value)} placeholder="YB-0000000001" />
        <span className="block mt-1 text-xs font-normal text-sec">Up to 100 entries. Separate IDs by spaces, commas or newlines. Invalid and unknown identifiers are reported.</span>
      </label>
      <label className="block text-sm font-semibold">Import CSV
        <input type="file" accept=".csv,text/csv" className="mt-1 block text-sm" onChange={(event) => { void importCsv(event.target.files?.[0]); event.target.value = ''; }} />
        <span className="block mt-1 text-xs font-normal text-sec">One column, optionally headed customer_id. Maximum 64 KB.</span>
      </label>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm font-semibold">From (UTC)<input required type="date" className={fieldClass('mt-1')} value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="text-sm font-semibold">Through (UTC)<input required type="date" min={from} className={fieldClass('mt-1')} value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-sm font-semibold">Country code (optional)<input maxLength={2} placeholder="US" value={country} onChange={event=>{setCountry(event.target.value.toUpperCase());setRegion('');}} className={fieldClass('mt-1')} /></label>
        <label className="text-sm font-semibold">Subdivision code (optional)<input maxLength={32} placeholder="US-TX" disabled={!country.trim()} value={region} onChange={event=>setRegion(event.target.value.toUpperCase())} className={fieldClass('mt-1')} /></label>
        <label className="text-sm font-semibold">Group results<select value={groupBy} onChange={event=>{
          const value=event.target.value;
          if(value==='input'||value==='country'||value==='region')setGroupBy(value);
        }} className={fieldClass('mt-1')}><option value="input">Input order</option><option value="country">Country</option><option value="region">Country and subdivision</option></select></label>
      </div>
      <label className="block text-sm font-semibold">Investigation reason
        <input required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className={fieldClass('mt-1')} />
      </label>
      {error && <div role="alert"><Alert tone="error">{error}</Alert></div>}
      <Button type="submit">Investigate customers</Button>
    </form></Surface>
    {notice && <p role="status" className="text-sm text-sec mb-4">{notice}</p>}
    {submitted && <><p className="text-xs text-sec mb-3">Results from the last submitted batch. Every page is permission-checked and audited; limit ten requests per minute.</p><InvestigationResults args={submitted} /></>}
  </>;
}
