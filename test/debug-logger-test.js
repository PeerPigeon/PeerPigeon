/**
 * Simple test to verify the debug logger system works correctly
 */
import DebugLogger from '../src/DebugLogger.js';
// Test basic functionality
console.log('=== Testing DebugLogger ===');
// Create a test logger
const testDebug = DebugLogger.create('TestModule');
console.log('\n1. Testing disabled state (default):');
testDebug.log('This should NOT appear (disabled)');
testDebug.warn('This warning should NOT appear (disabled)');
testDebug.error('This error should NOT appear (disabled)');
console.log('\n2. Testing enabled state:');
DebugLogger.enable('TestModule');
testDebug.log('✅ This log should appear (enabled)');
testDebug.warn('⚠️ This warning should appear (enabled)');
testDebug.error('❌ This error should appear (enabled)');
console.log('\n3. Testing disabled again:');
DebugLogger.disable('TestModule');
testDebug.log('This should NOT appear again (disabled)');
console.log('\n4. Testing enableAll:');
DebugLogger.enableAll();
testDebug.log('✅ This should appear (enableAll)');
console.log('\n5. Testing disableAll:');
DebugLogger.disableAll();
testDebug.log('This should NOT appear (disableAll)');
console.log('\n6. Testing multiple modules:');
const testDebug2 = DebugLogger.create('AnotherModule');
DebugLogger.enableModules(['TestModule', 'AnotherModule']);
testDebug.log('✅ TestModule should appear');
testDebug2.log('✅ AnotherModule should appear');
console.log('\n7. Testing state inspection:');
console.log('Current state:', DebugLogger.getState());
console.log('Available modules:', DebugLogger.getModules());
console.log('\n8. Testing configuration:');
DebugLogger.configure({
  disableAll: true,
  enable: ['TestModule']
});
testDebug.log('✅ Only TestModule should appear after configure');
testDebug2.log('AnotherModule should NOT appear after configure');
console.log('\n=== Debug Logger Test Complete ===');
// Clean up
DebugLogger.disableAll();
