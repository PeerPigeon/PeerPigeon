/**
 * Mock EnvironmentDetector for testing
 */

export const environmentDetector = {
  isBrowser: true,
  hasGetUserMedia: true,
  isNode: false,
  getEnvironmentReport: () => ({
    runtime: {
      isBrowser: true,
      isNodeJS: false,
      isWorker: false
    },
    capabilities: {
      webrtc: true,
      webSocket: true,
      localStorage: true,
      sessionStorage: true,
      randomValues: true
    },
    network: {
      online: true
    },
    browser: {
      name: 'jest',
      version: '1.0.0'
    }
  })
};
