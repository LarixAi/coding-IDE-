function isCodeMeSurface(tab) {
  const viewType = String((tab && tab.input && tab.input.viewType) || "");
  const label = String((tab && tab.label) || "");
  return viewType.includes("codeme.start")
    || viewType.includes("codeme.welcome")
    || label === "Start";
}

function hasWorkspaceEditorInGroups(groups) {
  for (const group of groups || []) {
    for (const tab of (group && group.tabs) || []) {
      if (isCodeMeSurface(tab)) continue;
      // Any non-CodeMe tab is a real editor surface. Some built-in surfaces such
      // as Simple Browser can briefly expose no input while their tab is opening;
      // requiring tab.input causes CodeMe Start to steal focus back.
      return true;
    }
  }
  return false;
}

module.exports = {
  isCodeMeSurface,
  hasWorkspaceEditorInGroups,
};
