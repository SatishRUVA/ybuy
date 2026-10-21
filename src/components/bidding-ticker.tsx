import { useEffect,useState } from 'react';
import { ArrowUpRight,Package } from 'lucide-react';
import { Alert,Button } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useFeatureFlag } from '@/lib/use-feature-flags';

interface TopBid { listing_id:string;title:string;daily_rate:number;start_date:string;end_date:string;expires_at:string;image_url:string|null }

function BidImage({url}:{url:string|null}) {
  const [failed,setFailed]=useState(false);
  return <span className="bid-card-image">
    {url&&!failed?<img src={url} alt="" onError={()=>setFailed(true)}/>:<Package size={30} aria-hidden="true"/>}
  </span>;
}

const formatDate=(value:string)=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${value}T00:00:00Z`));

export function BiddingTicker() {
  const {enabled}=useFeatureFlag('bidding');
  const [rows,setRows]=useState<TopBid[]|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [retry,setRetry]=useState(0);
  const [motionStopped,setMotionStopped]=useState(false);
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{
    if(!enabled)return;
    let active=true;
    async function refresh(){
      const response=await supabase.rpc('get_top_listing_bids');
      if(!active)return;
      if(response.error){setError(response.error.message);setRows([]);return;}
      if(!Array.isArray(response.data)||response.data.length>5){setError('The live bidding feed returned an invalid result.');setRows([]);return;}
      setError(null);setRows(response.data);setNow(Date.now());
    }
    void refresh();
    const poll=window.setInterval(()=>void refresh(),15000);
    const clock=window.setInterval(()=>setNow(Date.now()),1000);
    const visible=()=>{if(document.visibilityState==='visible')void refresh();};
    document.addEventListener('visibilitychange',visible);
    return()=>{active=false;window.clearInterval(poll);window.clearInterval(clock);document.removeEventListener('visibilitychange',visible);};
  },[enabled,retry]);
  if(!enabled)return null;
  if(error)return <div className="max-w-[1400px] mx-auto px-4 py-2"><Alert tone="error" title="Live offers unavailable">{error}<Button size="sm" variant="secondary" className="ml-2" onClick={()=>setRetry(value=>value+1)}>Retry offers</Button></Alert></div>;
  const eligible=rows?.filter(row=>Date.parse(row.expires_at)>now)??[];
  return <section aria-label="Top five eligible rental offers" className={`bid-banner${motionStopped?' bid-banner-stopped':''}`}>
    <div className="bid-banner-inner">
      <div className="bid-banner-heading">
        <button type="button" className="bid-banner-live" aria-label="Stop bidding ribbon motion" aria-pressed={motionStopped} title="Toggle ribbon motion" onClick={()=>setMotionStopped(value=>!value)}>
          <span aria-hidden="true"/>LIVE BIDDING
        </button>
        <h2>TOP 5 OFFERS</h2>
        {import.meta.env.VITE_TEST_ENVIRONMENT==='true'&&<p className="bid-banner-demo">Synthetic demo offers</p>}
      </div>
      {rows===null?<p role="status" className="bid-banner-message">Loading eligible offers…</p>:eligible.length===0?<p className="bid-banner-message">No eligible offers right now. <a className="underline font-semibold" href="/search">Explore listings</a></p>:
        <div className="bid-banner-viewport">
          <div className="bid-banner-track">
            {[0,1].map(copy=><div key={copy} className={`bid-banner-group${copy?' bid-banner-copy':''}`} aria-hidden={copy?true:undefined}>
              {eligible.map((row,index)=><a key={`${row.listing_id}:${index}`} href={`/listing/${row.listing_id}#rental-offer`} tabIndex={copy?-1:0} className="bid-card" title={row.title}>
                <span className="bid-card-rank" aria-label={`Rank ${index+1}`}>{String(index+1).padStart(2,'0')}</span>
                <BidImage key={row.image_url} url={row.image_url}/>
                <span className="bid-card-content">
                  <span className="bid-card-title">{row.title}</span>
                  <span className="bid-card-dates">{formatDate(row.start_date)} - {formatDate(row.end_date)}</span>
                </span>
                <span className="bid-card-price">${Number(row.daily_rate).toFixed(2)}<span>/day</span></span>
                <ArrowUpRight className="bid-card-cta" size={16} aria-hidden="true"/>
              </a>)}
            </div>)}
          </div>
        </div>
      }
    </div>
  </section>;
}
