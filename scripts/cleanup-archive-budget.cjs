'use strict';
const {verify}=require('./cleanup-recovery-archive'),{row}=require('./cleanup-database-observation');
function fromArchive(receipt){if(!receipt?.index)throw Error('cleanup_archive_required');return verify(receipt.index,receipt).tables;}
function consume(tables,deleted){
 if(!deleted||typeof deleted!=='object')throw Error('cleanup_archived_deleted_missing');
 for(const [table,rows]of Object.entries(deleted)){
  if(!Array.isArray(rows)||!Array.isArray(tables[table]))throw Error('cleanup_archive_table_missing:'+table);
  const remaining=[...tables[table]];
  for(const value of rows){const identity=row(table,value).key,index=remaining.findIndex(v=>row(table,v).key===identity);if(index<0)throw Error('cleanup_unarchived_payload:'+table);remaining.splice(index,1);}
  tables[table]=remaining;
 }
 return tables;
}
module.exports={fromArchive,consume};
