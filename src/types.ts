export interface ISettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  instructions: string;
}

export interface ITab {
  id: number;
  windowId: number;
  groupId: number;
  groupTitle?: string;
  groupColor?: chrome.tabGroups.TabGroup['color'];
  title: string;
  url: string;
  hostname: string;
}

export interface IGroup {
  targetGroupId?: number;
  title: string;
  color: chrome.tabGroups.TabGroup['color'];
  tabIds: number[];
}

export interface IUndoGroup {
  id: number;
  title: string;
  color: chrome.tabGroups.TabGroup['color'];
  tabs: ITab[];
}

export interface IOriginalGroup extends chrome.tabGroups.TabGroup {
  restoreId: number;
  pendingRestore?: chrome.tabGroups.TabGroup;
}

export interface IUndo {
  windowId: number;
  groups: IUndoGroup[];
  originalGroups: IOriginalGroup[];
}

export interface IBookmark {
  id: string;
  parentId: string;
  index: number;
  title: string;
  url: string;
  hostname: string;
}

export interface IBookmarkFolder {
  id: string;
  parentId: string;
  title: string;
  path: string;
}

export interface IBookmarkGroup {
  targetFolderId?: string;
  title: string;
  bookmarkIds: string[];
}

export interface IBookmarkScope {
  folder: IBookmarkFolder;
  bookmarks: IBookmark[];
  folders: IBookmarkFolder[];
}
