

export function convertIpfsToHttpUrl(ipfsUrl: string): string {
  if (!ipfsUrl) return '';
  
  // If it's already an HTTP URL, return as-is
  if (ipfsUrl.startsWith('http://') || ipfsUrl.startsWith('https://')) {
    return ipfsUrl;
  }
  
  // If it's an ipfs:// URL, convert to HTTP gateway
  if (ipfsUrl.startsWith('ipfs://')) {
    const cid = ipfsUrl.replace('ipfs://', '');
    
    // Try different public gateways (fallback in case one is down)
    const gateways = [
      `https://ipfs.io/ipfs/${cid}`,        // IPFS public gateway
      `https://gateway.pinata.cloud/ipfs/${cid}`, // Pinata gateway
      `https://cloudflare-ipfs.com/ipfs/${cid}`,  // Cloudflare gateway
      `https://dweb.link/ipfs/${cid}`,      // Protocol Labs gateway
      `https://ipfs.decoo.io/ipfs/${cid}`,  // Decoo gateway
    ];
    
    // Return the first gateway (ipfs.io is generally reliable)
    return gateways[0];
  }
  
  // If it's just a CID without protocol, assume it's an IPFS CID
  if (!ipfsUrl.includes('://') && ipfsUrl.length === 46 && ipfsUrl.startsWith('Qm')) {
    return `https://ipfs.io/ipfs/${ipfsUrl}`;
  }
  
  // Return as-is if we can't determine
  return ipfsUrl;
}


// Also create a function to check if a URL is IPFS
export function isIpfsUrl(url: string): boolean {
  return url.startsWith('ipfs://') || 
         (url.startsWith('Qm') && url.length === 46 && !url.includes('://'));
}


