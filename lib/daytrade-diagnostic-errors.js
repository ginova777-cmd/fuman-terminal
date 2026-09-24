"use strict";
// PostgreSQL JSONB rejects NUL even in error text. Keep a lossless original.
function encodeDiagnosticError(item) {
  if (!item || typeof item.message !== 'string' || !item.message.includes(String.fromCharCode(0))) return item;
  return {...item, message:item.message.split(String.fromCharCode(0)).join('\\u0000'),
    original_message_base64:Buffer.from(item.message,'utf8').toString('base64'), message_encoding:'nul_escaped_original_utf8_base64'};
}
module.exports={encodeDiagnosticError};
