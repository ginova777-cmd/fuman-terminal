'use strict';
const model=require('./unified-backtest-model.js'),{compactView}=require('./compact-view.cjs');
function queryView(view,query={}){
 if(!view||view.contract!=='unified-backtest-view-v1')return {contract:'unified-backtest-page-v1',available:false,notice:'共用封存資料尚未接入',strategies:[],signals:[],total:0,page:0,pages:1,summary:model.summarize([]),groups:[],research:[]};
 const source=String(query.source||'FORWARD_RECORDED');if(!['FORWARD_RECORDED','HISTORICAL_REPLAY','RECOVERED_RECORD'].includes(source))throw Error('INVALID_SOURCE_FILTER');
 const filters={source,strategy:String(query.strategy||''),direction:String(query.direction||''),type:String(query.type||''),status:String(query.status||''),from:String(query.from||''),to:String(query.to||'')};
 for(const d of [filters.from,filters.to])if(d&&!/^\d{4}-\d{2}-\d{2}$/.test(d))throw Error('INVALID_DATE_FILTER');if(filters.from&&filters.to&&filters.from>filters.to)throw Error('INVALID_DATE_RANGE');
 const rawPage=query.page===undefined?0:Number(query.page);if(!Number.isSafeInteger(rawPage)||rawPage<0)throw Error('INVALID_PAGE');
 const selected=model.select(view,filters),pages=Math.max(1,Math.ceil(selected.length/50)),page=Math.min(rawPage,pages-1);
 const signals=compactView({...view,signals:selected.slice(page*50,(page+1)*50)}).signals;
 return{contract:'unified-backtest-page-v1',available:true,notice:view.notice,strategies:view.strategies.filter(s=>model.isActiveStrategy(s.id)&&model.isActiveStrategy(s.name)),filters,signals,total:selected.length,page,pages,page_size:50,summary:model.summarize(selected),groups:model.groups(selected),research:model.researchGroups(selected)};
}
function signalDetail(view,id){if(typeof id!=='string'||!id||id.length>512)throw Error('INVALID_SIGNAL_ID');const signal=view?.signals?.find(s=>s.signal_id===id);return signal?{found:true,signal}:{found:false,signal:null};}
module.exports={queryView,signalDetail};
