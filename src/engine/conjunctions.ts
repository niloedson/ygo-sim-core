/**
 * @file conjunctions.ts
 * @description Official Konami PSCT Conjunction Resolution Engine & Missing Timing Validation.
 */

export type ConjunctionType = 'THEN' | 'AND_IF_YOU_DO' | 'ALSO' | 'AND';

export type TriggerTimingType =
  | 'WHEN_OPTIONAL' // "When... you can": SUBJECT TO MISSING TIMING
  | 'WHEN_MANDATORY' // "When...": NEVER misses timing (starts next chain link)
  | 'IF_OPTIONAL' // "If... you can": Modern PSCT, NEVER misses timing
  | 'IF_MANDATORY'; // "If...": NEVER misses timing

export interface ConjunctionResolutionResult {
  conjunction: ConjunctionType;
  eventASucceeded: boolean;
  eventBSucceeded: boolean;
  overallSuccess: boolean;
  lastEventsToOccur: ('EVENT_A' | 'EVENT_B')[];
}

/**
 * Evaluate the official Konami PSCT Conjunction truth table given success/failure of Event A and Event B.
 *
 * Truth Table & Timing Rules:
 * 1. "then" (Sequential, B depends on A):
 *    - A happens, then B happens.
 *    - If A fails, B does not happen.
 *    - If B happens, Event B is the ONLY last event to occur.
 *
 * 2. "and if you do" (Simultaneous, B depends on A):
 *    - If A fails, B does not happen.
 *    - If both happen, both are simultaneous last events.
 *
 * 3. "also" (Simultaneous, Independent):
 *    - A and B happen independently.
 *    - Both are simultaneous last events if they happen.
 *
 * 4. "and" (Simultaneous, Both Required):
 *    - Both must succeed; if either fails, neither considered successful.
 *    - If both succeed, both are simultaneous last events.
 */
export function evaluateConjunction(
  type: ConjunctionType,
  eventASucceeded: boolean,
  eventBSucceeded: boolean
): ConjunctionResolutionResult {
  switch (type) {
    case 'THEN': {
      // B only happens if A succeeded
      const actualBSucceeded = eventASucceeded && eventBSucceeded;
      const lastEvents: ('EVENT_A' | 'EVENT_B')[] = [];

      if (actualBSucceeded) {
        // Event B happened after Event A; therefore ONLY Event B is the last event!
        lastEvents.push('EVENT_B');
      } else if (eventASucceeded) {
        // Event B did not occur, so Event A is the last event
        lastEvents.push('EVENT_A');
      }

      return {
        conjunction: type,
        eventASucceeded,
        eventBSucceeded: actualBSucceeded,
        overallSuccess: eventASucceeded,
        lastEventsToOccur: lastEvents
      };
    }

    case 'AND_IF_YOU_DO': {
      const actualBSucceeded = eventASucceeded && eventBSucceeded;
      const lastEvents: ('EVENT_A' | 'EVENT_B')[] = [];

      if (actualBSucceeded) {
        // Simultaneous: both are the last event to occur
        lastEvents.push('EVENT_A', 'EVENT_B');
      } else if (eventASucceeded) {
        lastEvents.push('EVENT_A');
      }

      return {
        conjunction: type,
        eventASucceeded,
        eventBSucceeded: actualBSucceeded,
        overallSuccess: eventASucceeded,
        lastEventsToOccur: lastEvents
      };
    }

    case 'ALSO': {
      const lastEvents: ('EVENT_A' | 'EVENT_B')[] = [];
      if (eventASucceeded) lastEvents.push('EVENT_A');
      if (eventBSucceeded) lastEvents.push('EVENT_B');

      return {
        conjunction: type,
        eventASucceeded,
        eventBSucceeded,
        overallSuccess: eventASucceeded || eventBSucceeded,
        lastEventsToOccur: lastEvents
      };
    }

    case 'AND': {
      const bothSucceeded = eventASucceeded && eventBSucceeded;
      const lastEvents: ('EVENT_A' | 'EVENT_B')[] = bothSucceeded ? ['EVENT_A', 'EVENT_B'] : [];

      return {
        conjunction: type,
        eventASucceeded: bothSucceeded,
        eventBSucceeded: bothSucceeded,
        overallSuccess: bothSucceeded,
        lastEventsToOccur: lastEvents
      };
    }
  }
}

/**
 * Determine if a trigger effect MISSES TIMING under the resolved conjunction result.
 *
 * Konami Timing Rule:
 * Only optional triggers starting with "When... you can" can miss timing!
 * If the triggering event is NOT among the last events to occur, the trigger misses timing.
 *
 * Triggers with "If... you can" or mandatory triggers NEVER miss timing.
 */
export function willMissTiming(
  resolution: ConjunctionResolutionResult,
  triggerTiming: TriggerTimingType,
  triggeredByEvent: 'EVENT_A' | 'EVENT_B'
): boolean {
  // 1. Mandatory triggers NEVER miss timing
  if (triggerTiming === 'WHEN_MANDATORY' || triggerTiming === 'IF_MANDATORY') {
    return false;
  }

  // 2. "If... you can" triggers NEVER miss timing
  if (triggerTiming === 'IF_OPTIONAL') {
    return false;
  }

  // 3. For "When... you can", check if the triggering event was among the last events to occur
  return !resolution.lastEventsToOccur.includes(triggeredByEvent);
}
