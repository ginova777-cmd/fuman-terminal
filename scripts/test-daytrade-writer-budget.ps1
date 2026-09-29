$ErrorActionPreference='Stop'
$path=Join-Path $PSScriptRoot '..\ops\public-slot\Run-DaytradeSourceWriter.ps1'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
$fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-WriterProcessBudget'},$true)
Invoke-Expression $fn.Extent.Text
foreach($case in @(@(0,285),@(45,240),@(270,15),@(284.1,0),@(300,0))){
 if((Get-WriterProcessBudget -ElapsedSeconds $case[0]) -ne $case[1]){throw "unexpected budget $case"}
}
if((Get-WriterProcessBudget -ElapsedSeconds 45 -MaximumSeconds 450) -ne 240){throw 'env override bypassed task ceiling'}
if((Get-WriterProcessBudget -ElapsedSeconds 285 -ReserveSeconds 5) -ne 10){throw 'verifier cleanup reserve missing'}
foreach($bad in @(-1,[double]::NaN,[double]::PositiveInfinity)){
 $rejected=$false;try{Get-WriterProcessBudget -ElapsedSeconds $bad|Out-Null}catch{$rejected=$true};if(-not $rejected){throw 'invalid elapsed accepted'}
}
Write-Output 'PASS actual wrapper budget: prelude deduction, task cap, cleanup reserve, exhaustion and invalid inputs; no task started'
