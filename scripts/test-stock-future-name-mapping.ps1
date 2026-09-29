$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '../ops/public-slot/Run-PublicSlotSharedSource.ps1'
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'Production PowerShell syntax invalid'}
foreach($name in @('Normalize-StockFutureName','Get-StockNameLookup','Convert-StocksSlimToTickerRows')){
  $node=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  if(-not $node){throw "Missing function: $name"}
  Invoke-Expression $node.Extent.Text
}
function Convert-Market([string]$value){return $value}
function Write-Log([string]$value){$script:LastTestLog=$value}
$RuntimeDir=Join-Path ([IO.Path]::GetTempPath()) ('future-map-'+[guid]::NewGuid())
$data=New-Item -ItemType Directory -Path (Join-Path $RuntimeDir 'data')
$file=Join-Path $data.FullName 'stocks-slim.json'
# Exercise real parser with escaped Unicode and reversed JSON property order.
'{"stocks":[{"name":"\u5357\u4e9e","market":"TWSE","code":"1303"},{"code":"2330","name":"台積電","market":"TWSE"}]}' | Set-Content -LiteralPath $file -Encoding utf8
$lookup=Get-StockNameLookup
if($lookup['南亞'].symbol -ne '1303' -or $lookup['台積電'].symbol -ne '2330'){throw 'JSON decoding or field order failed'}
if((Normalize-StockFutureName '南亞期貨037') -ne '南亞'){throw 'Contract suffix mapping failed'}
'{"data":[{"symbol":"1303","name":"同名","market":"TWSE"},{"symbol":"2330","name":"同名","market":"TWSE"},{"symbol":"2317X","name":"錯誤代碼","market":"TWSE"}]}' | Set-Content -LiteralPath $file -Encoding utf8
$lookup=Get-StockNameLookup
if($lookup.Count -ne 0){throw 'Ambiguous or malformed mapping accepted'}
'{"stocks":[' | Set-Content -LiteralPath $file -Encoding utf8
if(@(Convert-StocksSlimToTickerRows).Count -ne 0 -or -not $script:LastTestLog){throw 'Malformed JSON must fail without partial rows'}
Write-Output 'PASS actual production mapping functions: Unicode, reordered fields, symbol aliases, ambiguous names, invalid symbols, malformed JSON'
