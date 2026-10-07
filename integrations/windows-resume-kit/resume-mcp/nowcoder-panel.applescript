use framework "Foundation"
use scripting additions

-- Fixed, narrow operation. Never activate Chrome, navigate, select a tab,
-- inspect a web area, type, or change system permissions.
on run argv
  try
    if (count of argv) is not 2 then return "failed"
    set expectedURL to item 1 of argv
    set deadlineMs to (item 2 of argv) as real
    if my expired(deadlineMs) then return "timeout"
    with timeout of 7 seconds
      set initialState to my currentTabState(expectedURL, missing value, missing value, "initial")
      if item 1 of initialState is not "ok" then return item 1 of initialState
      my reportStage("accessibility")
      tell application "System Events"
        if UI elements enabled is false then return "permission_required"
        -- Chromium enables its native accessibility tree when an AT reads the app role.
        get value of attribute "AXRole" of process "Google Chrome"
        set chromeWindow to value of attribute "AXFocusedWindow" of process "Google Chrome"
      end tell
      my reportStage("toolbar_search")
      set chromeToolbars to my findToolbars(chromeWindow, deadlineMs)
      log "NCP_COUNT:toolbarCount:" & (count of chromeToolbars)
      my reportStage("button_search")
      set candidates to my findButtons(chromeToolbars, deadlineMs)
      if (count of candidates) is 0 then return "button_not_found"
      if (count of candidates) is not 1 then return "ambiguous_button"
      set finalState to my currentTabState(expectedURL, item 2 of initialState, item 3 of initialState, "final")
      if item 1 of finalState is not "ok" then return item 1 of finalState
      if my expired(deadlineMs) then return "timeout"
      my reportStage("press")
      tell application "System Events"
        perform action "AXPress" of item 1 of candidates
      end tell
      my reportStage("completed")
      return "pressed"
    end timeout
  on error errorText number errorNumber
    if errorNumber is -1712 then return "timeout"
    if errorNumber is -1743 or errorNumber is -25211 or errorNumber is -10004 then return "permission_required"
    if errorText contains "assistive access" or errorText contains "辅助" or errorText contains "not authorized" or errorText contains "不允许发送 Apple 事件" then return "permission_required"
    return "failed"
  end try
end run

on expired(deadlineMs)
  set timestamp to (current application's NSDate's |date|()'s timeIntervalSince1970()) as real
  return timestamp * 1000 ≥ deadlineMs
end expired

on reportStage(stageName)
  -- Only fixed stage codes; never log URLs, UI labels, or raw errors.
  log "NCP_STAGE:" & stageName
end reportStage

on currentTabState(expectedURL, expectedWindowID, expectedTabID, stagePrefix)
  my reportStage(stagePrefix & "_frontmost")
  if application "Google Chrome" is not running then return {"browser_not_running"}
  tell application "System Events"
    if not (exists process "Google Chrome") then return {"browser_not_running"}
    if frontmost of process "Google Chrome" is false then return {"chrome_not_frontmost"}
  end tell
  my reportStage(stagePrefix & "_tab")
  tell application "Google Chrome"
    if (count of windows) is 0 then return {"no_window"}
    set windowID to id of front window
    set tabID to id of active tab of front window
    set currentURL to URL of active tab of front window
  end tell
  -- Compare character IDs: AppleScript text equality otherwise ignores case.
  if (id of currentURL) is not equal to (id of expectedURL) then return {"url_mismatch"}
  if expectedWindowID is not missing value then
    if windowID is not expectedWindowID or tabID is not expectedTabID then return {"window_changed"}
  end if
  return {"ok", windowID, tabID}
end currentTabState

on findToolbars(chromeWindow, deadlineMs)
  -- Chrome has additional wrapper groups in the actual focused AX window.
  -- Query only immediate toolbar/group collections, never page elements.
  set frontier to {chromeWindow}
  set visitedCount to 0
  repeat with depth from 0 to 4
    set found to {}
    repeat with uiNode in frontier
      if my expired(deadlineMs) then error number -1712
      set visitedCount to visitedCount + 1
      if visitedCount > 24 then error number -2700
      tell application "System Events"
        set found to found & (get UI elements of uiNode whose role is "AXToolbar")
      end tell
    end repeat
    -- Search all toolbars at the nearest chrome level for a unique button.
    if (count of found) > 0 then return found
    if depth is 4 then return {}
    set nextFrontier to {}
    repeat with uiNode in frontier
      if my expired(deadlineMs) then error number -1712
      tell application "System Events"
        set nextFrontier to nextFrontier & (get UI elements of uiNode whose role is "AXGroup" or role is "AXSplitGroup")
      end tell
      if (count of nextFrontier) > 24 then error number -2700
    end repeat
    log "NCP_COUNT:toolbarSearchDepth:" & depth
    log "NCP_COUNT:toolbarSearchNodes:" & visitedCount
    log "NCP_COUNT:nextGroups:" & (count of nextFrontier)
    if (count of nextFrontier) is 0 then return {}
    set frontier to nextFrontier
  end repeat
  return {}
end findToolbars

on findButtons(chromeToolbars, deadlineMs)
  set found to {}
  if (count of chromeToolbars) > 4 then error number -2700
  set frontier to chromeToolbars
  set visitedCount to 0
  -- Chrome can wrap extension buttons in groups that accessibility snapshots
  -- flatten. Stay inside toolbars and inspect only shallow group containers.
  repeat with depth from 0 to 3
    set nextFrontier to {}
    repeat with chromeToolbar in frontier
      if my expired(deadlineMs) then error number -1712
      set visitedCount to visitedCount + 1
      if visitedCount > 24 then error number -2700
      tell application "System Events"
        -- System Events description/name map to AXDescription/AXTitle.
        set found to found & (get UI elements of chromeToolbar whose (role is "AXButton" or role is "AXPopUpButton") and (description starts with "牛客网申助手" or name starts with "牛客网申助手"))
        if depth < 3 then set nextFrontier to nextFrontier & (get UI elements of chromeToolbar whose role is "AXGroup" or role is "AXToolbar")
      end tell
      if (count of found) > 1 then return found
      if (count of nextFrontier) > 24 then error number -2700
    end repeat
    if (count of nextFrontier) is 0 then exit repeat
    set frontier to nextFrontier
  end repeat
  log "NCP_COUNT:buttonSearchNodes:" & visitedCount
  log "NCP_COUNT:namedCandidates:" & (count of found)
  return found
end findButtons
