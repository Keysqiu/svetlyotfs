export type TfWorkfold = {
    collection: string
}

export type TfInfo = {
    localInformation: {
        serverPath: string
    }
}

export type Command = {
    title: string
    detail?: string
    command: string
}

export interface WorkspaceInfo {
    collection: string;
    workspaces: string[];
}

export interface PendingChange {
    chg: TfStatus;
    srcitem: string;
    local: string;
    date: string;
    type: string;
}

export enum TfStatus{
    AddEncoding = "Add Encoding",
    AddEditEncoding = "Add Edit Encoding",
    Add = "Add",
    Branch = "Branch",
    Delete = "Delete",
    Edit = "Edit",
    Encoding = "Encoding",
    Lock = "Lock",
    Merge = "Merge",
    None = "None",
    Property = "Property",
    Rename = "Rename",
    Rollback = "Rollback",
    SourceRename = "SourceRename",
    Undelete = "Undelete",
}

export interface Changeset {
    changesetId: number;
    user: string;
    date: string;
    comment: string;
    items: string[];
}

// 单行的标注信息
export interface BlameInfo {
    lineNumber: number;
    changesetId: number;
    author: string;
    date: string;
    content: string;
}

// 文件的完整标注信息
export interface BlameResult {
    filePath: string;
    blameInfo: BlameInfo[];
    timestamp: Date;
}

export function getDescriptionText(state: TfStatus){
switch(state){
    case TfStatus.AddEncoding:
        return '文件已添加';
    case TfStatus.AddEditEncoding:
        return '文件已添加';
    case TfStatus.Add:
        return '文件已添加';
    case TfStatus.Branch:
        return '文件已分支';
    case TfStatus.Delete:
        return '文件已删除';
    case TfStatus.Edit:
        return '文件已编辑';
    case TfStatus.Encoding:
        return '文件已编码';
    case TfStatus.Lock:
        return '文件已锁定';
    case TfStatus.Merge:
        return '文件已合并';
    case TfStatus.None:
        return '';
    case TfStatus.Property:
        return '文件属性';
    case TfStatus.Rename:
        return '文件已重命名';
    case TfStatus.Rollback:
        return '文件已回滚';
    case TfStatus.SourceRename:
        return '文件已源重命名';
    case TfStatus.Undelete:
        return '文件已取消删除';
}

}
