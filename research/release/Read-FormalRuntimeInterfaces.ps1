$ErrorActionPreference='Stop'
# Read-only: no task registration, mutation, process stop or mutex acquisition.
$scheduler=New-Object -ComObject 'Schedule.Service'
$scheduler.Connect()
$tasks=@()
function Read-Folder($folder) {
  foreach($task in $folder.GetTasks(1)) {
    if($task.Name -match '(?i)fugle|daytrade|mother.pool') {
      $xml=[xml]$task.Xml
      $definition=$scheduler.NewTask(0)
      $definition.XmlText=$task.Xml
      $roundtrip=($definition.Actions.Count -eq $task.Definition.Actions.Count -and $definition.Triggers.Count -eq $task.Definition.Triggers.Count -and $definition.Settings.MultipleInstances -eq $task.Definition.Settings.MultipleInstances)
      for($i=1;$i -le $definition.Actions.Count;$i++){$a=$definition.Actions.Item($i);$b=$task.Definition.Actions.Item($i);if($a.Type -ne 0 -or $b.Type -ne 0 -or $a.Path -ne $b.Path -or $a.Arguments -ne $b.Arguments -or $a.WorkingDirectory -ne $b.WorkingDirectory){$roundtrip=$false}}
      $script:tasks+=@{in_memory_definition_roundtrip=$roundtrip;registered_test_task=$false;path=$task.Path;enabled=$task.Enabled;state=[int]$task.State;last_run=$task.LastRunTime;next_run=$task.NextRunTime;xml_sha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($task.Xml)));actions=@($xml.Task.Actions.Exec | ForEach-Object { @{command=$_.Command;entrypoints=@([regex]::Matches([string]$_.Arguments,'[\w.-]+\.(ps1|js|cjs|vbs)') | ForEach-Object Value)} })}
    }
  }
  foreach($child in $folder.GetFolders(0)){Read-Folder $child}
}
Read-Folder ($scheduler.GetFolder('\'))
$allProcesses=@(Get-CimInstance Win32_Process)
$unresolved=@($allProcesses | Where-Object { $_.Name -match "^(node|pwsh|powershell)\.exe$" -and [string]::IsNullOrEmpty($_.CommandLine) } | Select-Object ProcessId,Name,CreationDate)
$processes=@($allProcesses | Where-Object { $_.Name -match 'node|pwsh|powershell' -and $_.CommandLine -match '(?i)fugle|daytrade|mother.pool' } | ForEach-Object {
  @{pid=$_.ProcessId;parent_pid=$_.ParentProcessId;creation_date=$_.CreationDate;executable=$_.ExecutablePath;entrypoints=@([regex]::Matches([string]$_.CommandLine,'[\w.-]+\.(ps1|js|cjs)') | ForEach-Object Value)}
})
$os=Get-CimInstance Win32_OperatingSystem
@{checked_at=[DateTimeOffset]::UtcNow.ToString('o');mode='READ_ONLY';task_interface='Schedule.Service COM';tasks=$tasks;processes=$processes;total_ram_bytes=[long]$os.TotalVisibleMemorySize*1024;available_ram_bytes=[long]$os.FreePhysicalMemory*1024;unresolved_process_identities=$unresolved;process_inventory_complete=($unresolved.Count -eq 0);mutation_attempts=0} | ConvertTo-Json -Depth 12
