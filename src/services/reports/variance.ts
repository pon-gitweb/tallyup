// @ts-nocheck
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getApp } from 'firebase/app';

// ---------- helpers ----------
const n = (v:any,d=0)=>Number.isFinite(+v)?+v:d;
const s = (v:any,d='')=>typeof v==='string'&&v.trim()?v.trim():d;

// ---------- types ----------
type LegacyItem = { id:string; name:string; departmentId?:string|null; unitCost?:number|null; par?:number|null };
type LegacyInput = {
  items: LegacyItem[];
  lastCountsByItemId: Record<string,number>;
  receivedByItemId?: Record<string,number>;
  soldByItemId?: Record<string,number>;
  filterDepartmentId?: string|null;
};
type LegacyRow = {
  itemId: string;
  name: string;
  qty: number;
  value: number;
  theoreticalOnHand: number;
  deltaVsPar: number;
  valueImpact: number;
};
type LegacyResult = {
  scope: { venueId:string };
  shortages: LegacyRow[];
  excesses: LegacyRow[];
  totalShortageValue: number;
  totalExcessValue: number;
};
type UIResult = { summary:{message:string;withinBand:boolean;bandPct:number}; rowsMaterial:any[]; rowsMinor:any[] };

// ---------- async path (UI) ----------
async function getLatestCompletedAt(db:any, venueId:string){
  const deps = await getDocs(collection(db,'venues',venueId,'departments'));
  let newest:null|number=null;
  for(const dep of deps.docs){
    const areas=await getDocs(collection(db,'venues',venueId,'departments',dep.id,'areas'));
    areas.forEach(a=>{
      const c=a.data()?.completedAt;
      if(c?.toMillis){
        const ms=c.toMillis();
        if(!newest||ms>newest)newest=ms;
      }
    });
  }
  return newest;
}

export async function buildVariance(venueId:string,opts:any={}):Promise<UIResult>{
  const db=getFirestore(getApp());
  const bandPct=n(opts.bandPct,1.5);
  const products=await getDocs(collection(db,'venues',venueId,'products'));
  const meta:Record<string,any>={};
  products.forEach(d=>{ const v=d.data()||{}; meta[d.id]={par:v.par??v.parLevel,cost:n(v.costPrice??v.price??v.unitCost,0)}; });
  const baseline=await getLatestCompletedAt(db,venueId);
  if(!baseline)return{summary:{message:'No completed stocktake',withinBand:true,bandPct},rowsMaterial:[],rowsMinor:[]};
  return{summary:{message:'placeholder variance',withinBand:true,bandPct},rowsMaterial:[],rowsMinor:[]};
}

// ---------- sync path for tests ----------
export function computeVarianceFromData(data:LegacyInput):LegacyResult{
  const items=data.items||[];
  const last=data.lastCountsByItemId||{};
  const rec=data.receivedByItemId||{};
  const sold=data.soldByItemId||{};
  const dept=data.filterDepartmentId||null;

  const shortages:LegacyRow[]=[]; const excesses:LegacyRow[]=[];
  for(const it of items){
    if(dept && s(it.departmentId||'')!==dept)continue;
    const par=n(it.par,0);
    const cost=n(it.unitCost,0);
    const theoretical=n(last[it.id],0)+n(rec[it.id],0)-n(sold[it.id],0);
    const delta=theoretical-par;
    const valueImpact=Math.abs(delta)*cost;

    const row:LegacyRow={
      itemId:it.id,
      name:it.name,
      qty:Math.abs(delta),
      value:cost*Math.abs(delta),
      theoreticalOnHand:theoretical,
      deltaVsPar:delta,
      valueImpact,
    };
    if(delta<0)shortages.push(row);
    else if(delta>0)excesses.push(row);
  }

  const totalShortageValue=shortages.reduce((a,r)=>a+r.value,0);
  const totalExcessValue=excesses.reduce((a,r)=>a+r.value,0);
  return{scope:{venueId:'unknown'},shortages,excesses,totalShortageValue,totalExcessValue};
}

// ---------- unified overload ----------
export function computeVariance(data:LegacyInput):LegacyResult;
export function computeVariance(venueId:string,opts?:any):Promise<UIResult>;
export function computeVariance(arg1:any,arg2?:any):any{
  return (typeof arg1==='object'&&!Array.isArray(arg1))
    ? computeVarianceFromData(arg1)
    : buildVariance(String(arg1),arg2||{});
}

export async function computeVarianceForDepartment(v:string,d:string,o:any={}):Promise<UIResult>{
  return buildVariance(v,o);
}

export default{buildVariance,computeVariance,computeVarianceForDepartment,computeVarianceFromData};
