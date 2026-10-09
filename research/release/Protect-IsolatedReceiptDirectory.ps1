param([Parameter(Mandatory)][string]$Directory)
$ErrorActionPreference='Stop'
$resolved=(Resolve-Path -LiteralPath $Directory).Path
if($resolved -match 'fuman-runtime|fuman-release-owner|prod81'){throw 'FORMAL_PATH_NOT_AUTHORIZED'}
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=[Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true,$false)
foreach($value in @($sid.Value,'S-1-5-18','S-1-5-32-544')){
 $id=[Security.Principal.SecurityIdentifier]::new($value)
 $rule=[Security.AccessControl.FileSystemAccessRule]::new($id,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
 $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $resolved -AclObject $acl
$read=Get-Acl -LiteralPath $resolved
$rules=@($read.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
$unexpected=@($rules|Where-Object {$_.IdentityReference.Value -notin @($sid.Value,'S-1-5-18','S-1-5-32-544')})
if(!$read.AreAccessRulesProtected -or $unexpected.Count){throw 'ACL_READBACK_FAILED'}
@{status='ISOLATED_ACL_VERIFIED';directory=$resolved;owner_sid=$sid.Value;allowed_sids=@($rules.IdentityReference.Value);sddl=$read.Sddl;protected=$read.AreAccessRulesProtected}|ConvertTo-Json -Compress
