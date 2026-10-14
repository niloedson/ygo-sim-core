import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logcat, LogcatLogger } from '../src/logging/logcat.js';
import {
  globalCardRegistry,
  loadAllArchetypes,
  createInitialGameState,
  advancePhase,
  exploreComboTree,
  simulateHands
} from '../src/index.js';

describe('Android Logcat Logging & Deep Combo Line Tracing (ygo-lab, ygo-judge, ygo-pilot)', () => {
  const testLogDir = resolve(process.cwd(), 'logs/test');

  beforeEach(() => {
    LogcatLogger.resetInstance();
    globalCardRegistry.clear();
    loadAllArchetypes();
  });

  afterEach(() => {
    if (existsSync(testLogDir)) {
      try {
        rmSync(testLogDir, { recursive: true, force: true });
      } catch {
        // Suppress cleanup issues on locked files
      }
    }
  });

  it('formats log lines strictly according to Android Logcat standard', () => {
    const logger = new LogcatLogger({
      logDir: testLogDir,
      logLevel: 'DEBUG',
      enableConsole: false,
      tid: 1
    });

    const formatted = logger.formatLine('D', 'SimCore:ActionDiscovery', 'Found 3 legal actions');
    // Regex: MM-DD HH:mm:ss.SSS <PID> <TID> P/Tag: Message
    const logcatRegex = /^\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\s+\d+\s+\d+\s+D\/SimCore:ActionDiscovery: Found 3 legal actions$/;
    expect(formatted).toMatch(logcatRegex);
  });

  it('stamps grep-friendly combo line signatures ([LINE#<idx>:<hash>]) onto log messages', () => {
    const logger = new LogcatLogger({
      logDir: testLogDir,
      logLevel: 'DEBUG',
      enableConsole: false
    });

    const sig = 'LINE#001:c7b2';
    const formatted = logger.formatLine('I', 'SimCore:TreeTraversal', 'Terminal YBN reached', sig);
    expect(formatted).toContain(`I/SimCore:TreeTraversal: [${sig}] Terminal YBN reached`);

    // Verify grep matching pattern
    expect(formatted).toMatch(new RegExp(`\\[${sig}\\]`));
  });

  it('respects log level priority filtering (INFO suppresses DEBUG and VERBOSE)', () => {
    const logger = new LogcatLogger({
      logDir: testLogDir,
      logLevel: 'INFO',
      enableConsole: false
    });

    expect(logger.v('SimCore:Test', 'verbose msg')).toBeNull();
    expect(logger.d('SimCore:Test', 'debug msg')).toBeNull();
    expect(logger.i('SimCore:Test', 'info msg')).not.toBeNull();
    expect(logger.w('SimCore:Test', 'warn msg')).not.toBeNull();
    expect(logger.e('SimCore:Test', 'error msg')).not.toBeNull();
  });

  it('generates execution-differentiated log files with timestamp and PID', () => {
    const logger = new LogcatLogger({
      logDir: testLogDir,
      logLevel: 'DEBUG',
      enableConsole: false
    });

    const logPath = logger.getLogFilePath();
    expect(logPath).toBeDefined();
    expect(existsSync(logPath!)).toBe(true);

    logger.d('SimCore:Test', 'Test execution event 1');
    logger.i('SimCore:Test', 'Test execution event 2');

    const content = readFileSync(logPath!, 'utf-8');
    expect(content).toContain('beginning of main');
    expect(content).toContain('Test execution event 1');
    expect(content).toContain('Test execution event 2');
  });

  it('isolates single combo lines using grep signature filtering', () => {
    const logger = new LogcatLogger({
      logDir: testLogDir,
      logLevel: 'DEBUG',
      enableConsole: false
    });

    const sig1 = 'LINE#001:a1b2';
    const sig2 = 'LINE#002:c3d4';

    logger.d('SimCore:TreeTraversal', 'Starting Line 1', sig1);
    logger.d('SimCore:TreeTraversal', 'Starting Line 2', sig2);
    logger.i('SimCore:ActionDiscovery', 'Applied move on Line 1', sig1);
    logger.i('SimCore:ActionDiscovery', 'Applied move on Line 2', sig2);
    logger.i('SimCore:BoardScorer', 'Terminal score Line 1', sig1);

    const content = readFileSync(logger.getLogFilePath()!, 'utf-8');
    const lines = content.split('\n');

    const line1Matches = lines.filter((l) => l.includes(sig1));
    expect(line1Matches.length).toBe(3);
    expect(line1Matches.every((l) => l.includes(sig1))).toBe(true);
    expect(line1Matches.some((l) => l.includes(sig2))).toBe(false);

    const line2Matches = lines.filter((l) => l.includes(sig2));
    expect(line2Matches.length).toBe(2);
    expect(line2Matches.every((l) => l.includes(sig2))).toBe(true);
  });

  it('logs phase transitions through advancePhase with active line signature', () => {
    const logger = Logcat.configure({
      logDir: testLogDir,
      logLevel: 'DEBUG',
      enableConsole: false
    });

    const state = createInitialGameState();
    const sig = 'LINE#005:e5f6';

    // Advance M1 -> EP on Turn 1
    const nextState = advancePhase(state, 'EP', sig);
    expect(nextState.phase).toBe('EP');

    const content = readFileSync(logger.getLogFilePath()!, 'utf-8');
    expect(content).toContain('Phase transition: M1 -> EP');
    expect(content).toContain(`[${sig}]`);
  });

  it('executes Monte Carlo with integrated deep line tracing (depth up to 40) and attaches evaluated_lines', () => {
    Logcat.configure({
      logDir: testLogDir,
      logLevel: 'DEBUG',
      enableConsole: false
    });

    const sampleDeck = `
#main
5109321
5109321
5109321
78710386
78710386
78710386
20357457
20357457
20357457
44573911
33438265
6043161
14558127
14558127
14558127
24224830
#extra
6821579
32216688
80071619
!side
41420027
    `.trim();

    const result = simulateHands(
      sampleDeck,
      {
        sampleSize: 20,
        traceLines: true,
        traceLimit: 5,
        maxDepth: 40
      },
      globalCardRegistry
    );

    expect(result.totalSimulations).toBe(20);
    expect(result.evaluatedLines).toBeDefined();
    expect(result.evaluatedLines!.length).toBeGreaterThanOrEqual(1);
    expect(result.logFilePath).toBeDefined();

    const sampleLine = result.evaluatedLines![0]!;
    expect(sampleLine.line_signature).toMatch(/^LINE#\d{3}:[a-f0-9]{4}$/);
    expect(sampleLine.opening_hand.length).toBe(5);
    expect(sampleLine.terminal_ybn).toBeDefined();
    expect(sampleLine.ygn_path).toBeDefined();
    expect(sampleLine.interruption_breakdown).toBeDefined();

    // Verify log file records the evaluated line with its line_signature
    const logContent = readFileSync(result.logFilePath!, 'utf-8');
    expect(logContent).toContain(sampleLine.line_signature);
  });
});
