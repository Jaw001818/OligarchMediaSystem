export class ConflictResolverService {
  static resolve(localRecord: any, remoteRecord: any): any {
    if (!remoteRecord) return localRecord;
    
    // Compare last modified timestamps
    const localTime = localRecord.lastModified || localRecord.updatedAt || 0;
    const remoteTime = remoteRecord.lastModified || remoteRecord.updatedAt || 0;

    // Convert string dates to timestamps if needed
    const localTs = typeof localTime === 'string' ? new Date(localTime).getTime() : localTime;
    const remoteTs = typeof remoteTime === 'string' ? new Date(remoteTime).getTime() : remoteTime;

    if (localTs >= remoteTs) {
      return localRecord; // Newest version wins
    }
    
    return remoteRecord;
  }
}
