/**
 * Debug PigeonRTC initialization
 */

import { environmentDetector } from '../index.js';

async function debug() {
  console.log('Initializing PigeonRTC...');
  await environmentDetector.initWebRTCAsync();
  
  const pigeonRTC = environmentDetector.getPigeonRTC();
  console.log('PigeonRTC:', pigeonRTC);
  console.log('Adapter Name:', pigeonRTC.getAdapterName());
  console.log('Is Supported:', pigeonRTC.isSupported());
  
  const RTCPeerConnection = pigeonRTC.getRTCPeerConnection();
  console.log('RTCPeerConnection type:', typeof RTCPeerConnection);
  console.log('RTCPeerConnection:', RTCPeerConnection);
  
  // Check what we're getting from @koush/wrtc directly
  try {
    const wrtc = await import('@koush/wrtc');
    console.log('\nDirect @koush/wrtc import:', wrtc);
    console.log('wrtc.RTCPeerConnection:', wrtc.RTCPeerConnection);
    console.log('wrtc.default:', wrtc.default);
    
    // Try creating directly
    if (wrtc.RTCPeerConnection) {
      const pc = new wrtc.RTCPeerConnection({ iceServers: [] });
      console.log('Direct creation works!', pc);
      pc.close();
    }
  } catch (error) {
    console.error('Error importing @koush/wrtc:', error);
  }
}

debug();
