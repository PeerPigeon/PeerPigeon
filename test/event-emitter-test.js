#!/usr/bin/env node

/**
 * Test script for new EventEmitter methods
 * Tests the standard Node.js EventEmitter compatible methods
 */

import { EventEmitter } from '../src/EventEmitter.js';

function runTests() {
  console.log('🧪 Testing EventEmitter new methods...\n');
  
  const emitter = new EventEmitter();
  let testCount = 0;
  let passCount = 0;
  
  function test(name, testFn) {
    testCount++;
    try {
      testFn();
      console.log(`✅ ${name}`);
      passCount++;
    } catch (error) {
      console.log(`❌ ${name}: ${error.message}`);
    }
  }
  
  // Test .on() method
  test('on() method adds listener and returns this', () => {
    let called = false;
    const result = emitter.on('test1', () => { called = true; });
    
    if (result !== emitter) throw new Error('on() should return this');
    
    emitter.emit('test1');
    if (!called) throw new Error('Listener not called');
  });
  
  // Test method chaining
  test('Method chaining works', () => {
    let count = 0;
    emitter
      .on('chain1', () => count++)
      .on('chain2', () => count++)
      .on('chain3', () => count++);
    
    emitter.emit('chain1');
    emitter.emit('chain2');
    emitter.emit('chain3');
    
    if (count !== 3) throw new Error(`Expected 3 calls, got ${count}`);
  });
  
  // Test .off() method
  test('off() method removes listener', () => {
    let called = false;
    const listener = () => { called = true; };
    
    emitter.on('test2', listener);
    emitter.off('test2', listener);
    emitter.emit('test2');
    
    if (called) throw new Error('Listener should have been removed');
  });
  
  // Test .once() method
  test('once() method auto-removes after one call', () => {
    let callCount = 0;
    emitter.once('test3', () => callCount++);
    
    emitter.emit('test3');
    emitter.emit('test3');
    emitter.emit('test3');
    
    if (callCount !== 1) throw new Error(`Expected 1 call, got ${callCount}`);
  });
  
  // Test .removeAllListeners() with specific event
  test('removeAllListeners(event) removes all listeners for event', () => {
    let count1 = 0;
    let count2 = 0;
    
    emitter.on('test4', () => count1++);
    emitter.on('test4', () => count1++);
    emitter.on('other', () => count2++);
    
    emitter.removeAllListeners('test4');
    emitter.emit('test4');
    emitter.emit('other');
    
    if (count1 !== 0) throw new Error('test4 listeners should be removed');
    if (count2 !== 1) throw new Error('other listeners should remain');
  });
  
  // Test .removeAllListeners() without arguments
  test('removeAllListeners() removes all listeners', () => {
    let called = false;
    emitter.on('test5', () => { called = true; });
    emitter.removeAllListeners();
    emitter.emit('test5');
    
    if (called) throw new Error('All listeners should be removed');
  });
  
  // Test .listeners() method
  test('listeners() returns array of listeners', () => {
    const listener1 = () => {};
    const listener2 = () => {};
    
    emitter.on('test6', listener1);
    emitter.on('test6', listener2);
    
    const listeners = emitter.listeners('test6');
    if (!Array.isArray(listeners)) throw new Error('Should return array');
    if (listeners.length !== 2) throw new Error(`Expected 2 listeners, got ${listeners.length}`);
    if (!listeners.includes(listener1)) throw new Error('Should include listener1');
    if (!listeners.includes(listener2)) throw new Error('Should include listener2');
  });
  
  // Test .listenerCount() method
  test('listenerCount() returns correct count', () => {
    emitter.removeAllListeners('test7');
    emitter.on('test7', () => {});
    emitter.on('test7', () => {});
    emitter.on('test7', () => {});
    
    const count = emitter.listenerCount('test7');
    if (count !== 3) throw new Error(`Expected 3 listeners, got ${count}`);
    
    const zeroCount = emitter.listenerCount('nonexistent');
    if (zeroCount !== 0) throw new Error(`Expected 0 listeners for nonexistent event, got ${zeroCount}`);
  });
  
  // Test .eventNames() method
  test('eventNames() returns array of event names', () => {
    emitter.removeAllListeners();
    emitter.on('event1', () => {});
    emitter.on('event2', () => {});
    emitter.on('event3', () => {});
    
    const names = emitter.eventNames();
    if (!Array.isArray(names)) throw new Error('Should return array');
    if (names.length !== 3) throw new Error(`Expected 3 event names, got ${names.length}`);
    if (!names.includes('event1')) throw new Error('Should include event1');
    if (!names.includes('event2')) throw new Error('Should include event2');
    if (!names.includes('event3')) throw new Error('Should include event3');
  });
  
  // Test backwards compatibility
  test('Original methods still work', () => {
    let called = false;
    emitter.addEventListener('compat', () => { called = true; });
    emitter.emit('compat');
    
    if (!called) throw new Error('addEventListener should still work');
    
    emitter.removeEventListener('compat', () => {});
    // Test passes if no errors thrown
  });
  
  // Test data passing
  test('Event data is passed correctly', () => {
    let receivedData = null;
    emitter.on('datatest', (data) => { receivedData = data; });
    
    const testData = { message: 'Hello', number: 42 };
    emitter.emit('datatest', testData);
    
    if (receivedData !== testData) throw new Error('Data not passed correctly');
  });
  
  console.log(`\n📊 Test Results: ${passCount}/${testCount} passed`);
  
  if (passCount === testCount) {
    console.log('🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed!');
    process.exit(1);
  }
}

runTests();
