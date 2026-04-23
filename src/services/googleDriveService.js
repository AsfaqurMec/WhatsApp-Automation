const { google } = require("googleapis");

const { withRetry } = require("../utils/retry");

class GoogleDriveService {
  constructor(config) {
    const oauth2Client = new google.auth.OAuth2(
      config.googleClientId,
      config.googleClientSecret,
      config.googleRedirectUri
    );

    oauth2Client.setCredentials({
      refresh_token: config.googleRefreshToken,
    });

    this.drive = google.drive({
      version: "v3",
      auth: oauth2Client,
    });
    this.setFolderId(config.driveFolderId);
  }

  setFolderId(folderId) {
    this.folderId = folderId;
    this.folderLink = folderId
      ? `https://drive.google.com/drive/folders/${folderId}`
      : null;
  }

  async getFilesCreatedAfter(createdAfterIso) {
    return withRetry(
      async () => {
        const folderTree = await this.getFolderTree();
        const folderIds = Object.keys(folderTree);
        const files = await this.listFilesAcrossFolders(folderIds, createdAfterIso);

        return files.map((file) => ({
          ...file,
          parentFolderName: this.getParentFolderName(file, folderTree),
          folderLink: this.folderLink,
        }));
      },
      { context: "Google Drive polling" }
    );
  }

  async getFolderTree() {
    if (!this.folderId) {
      throw new Error("Drive folder ID is not configured.");
    }

    const folderTree = {
      [this.folderId]: {
        id: this.folderId,
        name: null,
        parentId: null,
      },
    };
    const queue = [this.folderId];

    while (queue.length > 0) {
      const currentFolderId = queue.shift();
      const childFolders = await this.listChildFolders(currentFolderId);

      for (const folder of childFolders) {
        if (!folderTree[folder.id]) {
          folderTree[folder.id] = {
            id: folder.id,
            name: folder.name || null,
            parentId: currentFolderId,
          };
          queue.push(folder.id);
        }
      }
    }

    return folderTree;
  }

  async listChildFolders(parentFolderId) {
    const q = `'${parentFolderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`;
    const folders = [];
    let pageToken;

    do {
      const response = await this.drive.files.list({
        q,
        pageSize: 100,
        pageToken,
        fields: "nextPageToken,files(id,name)",
      });

      folders.push(...(response.data.files || []));
      pageToken = response.data.nextPageToken;
    } while (pageToken);

    return folders;
  }

  async listFilesAcrossFolders(folderIds, createdAfterIso) {
    const files = [];
    const parentClauses = folderIds.map((id) => `'${id}' in parents`);
    const batchSize = 25;

    for (let index = 0; index < parentClauses.length; index += batchSize) {
      const batchParents = parentClauses.slice(index, index + batchSize);
      let q = `(${batchParents.join(" or ")}) and trashed = false`;
      if (createdAfterIso) {
        q += ` and createdTime > '${createdAfterIso}'`;
      }

      let pageToken;
      do {
        const response = await this.drive.files.list({
          q,
          orderBy: "createdTime asc",
          pageSize: 100,
          pageToken,
          fields: "nextPageToken,files(id,name,createdTime,webViewLink,parents)",
        });

        files.push(...(response.data.files || []));
        pageToken = response.data.nextPageToken;
      } while (pageToken);
    }

    return files.sort(
      (first, second) =>
        new Date(first.createdTime).getTime() - new Date(second.createdTime).getTime()
    );
  }

  getParentFolderName(file, folderTree) {
    const parentId = Array.isArray(file.parents) ? file.parents[0] : null;
    if (!parentId || parentId === this.folderId) {
      return null;
    }

    return folderTree[parentId]?.name || null;
  }
}

module.exports = GoogleDriveService;
