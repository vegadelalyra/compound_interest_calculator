#!/usr/bin/env node
'use strict';

const yargs = require('yargs');
const prompt = require('prompt-sync')({ sigint: true });

// --- Helper functions for cleaning and validating inputs ---

function trimInput(input) {
  return input.toString().trim().slice(0, 10);
}

function extractDigits(str) {
  return str.replace(/\D/g, '');
}

function extractSignedNumber(str) {
  str = trimInput(str);
  let isNeg = /^-/.test(str);
  let digits = str.replace(/[^0-9]/g, '');
  if (!digits) return null;
  return isNeg ? -Number(digits) : Number(digits);
}

function validateGoal(input) {
  input = trimInput(input);
  const numStr = extractDigits(input);
  const val = Number(numStr);
  return val > 0 ? val : null;
}

// --- Withdraw Date Parsing ---
const MONTHS_MAP = {
  '01': '01',
  1: '01',
  '02': '02',
  2: '02',
  '03': '03',
  3: '03',
  '04': '04',
  4: '04',
  '05': '05',
  5: '05',
  '06': '06',
  6: '06',
  '07': '07',
  7: '07',
  '08': '08',
  8: '08',
  '09': '09',
  9: '09',
  10: '10',
  11: '11',
  12: '12',
  ene: '01',
  jan: '01',
  feb: '02',
  mar: '03',
  abr: '04',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  ago: '08',
  aug: '08',
  sep: '09',
  set: '09',
  oct: '10',
  nov: '11',
  dic: '12',
  dec: '12',
};

function parseWithdrawDate(input) {
  input = trimInput(input).toLowerCase();
  let digits = input.replace(/\D/g, '');
  let letters = input.replace(/[^a-z]/g, '');
  if (digits.length < 2) return null;
  let yearPart = digits.slice(0, 2);
  let year = '20' + yearPart;
  let month = '';
  if (digits.length >= 3) {
    month = digits.slice(2, 4);
  } else if (letters.length > 0) {
    month = letters.slice(0, 3);
  }
  if (!month) month = '01';
  if (MONTHS_MAP[month]) {
    month = MONTHS_MAP[month];
  } else {
    let mNum = Number(month);
    if (isNaN(mNum) || mNum < 1) {
      month = '01';
    } else if (mNum > 12) {
      month = '12';
    } else {
      month = mNum < 10 ? '0' + mNum : '' + mNum;
    }
  }
  const now = new Date();
  let currentYear = now.getFullYear();
  let currentMonth = now.getMonth() + 1;
  if (
    Number(year) < currentYear ||
    (Number(year) === currentYear && Number(month) < currentMonth)
  ) {
    return null;
  }
  return { year: Number(year), month: month };
}

function validateInitialCapital(input) {
  const val = extractSignedNumber(input);
  if (val === null) return 0;
  return isNaN(val) ? null : val;
}

function validateMaxDeposit(input, initialCapital, goal) {
  const val = extractSignedNumber(input);
  if (val === null) return 0;
  if (isNaN(val)) return null;
  // Here, if negative, we assume it means withdrawals,
  // but we also require that initialCapital - deposit remains >= 0.
  if (val < 0 && initialCapital - val < 0) return null;
  if (val > goal) return null;
  return val;
}

// --- Yargs Setup ---
const argv = yargs
  .option('goal', {
    alias: 'g',
    description: 'Goal amount',
    type: 'string',
  })
  .option('withdrawDate', {
    alias: 'w',
    description:
      'Withdraw date in format (YYMM or YY[month_abbr]), e.g., "25ago" or "2508"',
    type: 'string',
  })
  .option('initialCapital', {
    alias: 'i',
    description: 'Initial capital (can be negative)',
    type: 'string',
  })
  .option('maxDeposit', {
    alias: 'm',
    description: 'Maximum monthly deposit (or withdraw if negative)',
    type: 'string',
  })
  .help()
  .alias('help', 'h').argv;

function askInput(promptText, validateFn, extraParams = {}) {
  let result = null;
  while (result === null) {
    let userInput = prompt(promptText);
    userInput = trimInput(userInput);
    result = validateFn(userInput, ...Object.values(extraParams));
    if (result === null) {
      console.log(`Please introduce a valid value for ${promptText}`);
    }
  }
  return result;
}

let goal = argv.goal ? validateGoal(argv.goal) : null;
if (goal === null) {
  goal = askInput('Goal: ', validateGoal);
}

let withdrawDate = argv.withdrawDate ? parseWithdrawDate(argv.withdrawDate) : null;
if (withdrawDate === null) {
  withdrawDate = askInput('Withdraw date (YY MM): 20', parseWithdrawDate);
}

let initialCapital = argv.initialCapital
  ? validateInitialCapital(argv.initialCapital)
  : null;
if (initialCapital === null) {
  initialCapital = askInput('Initial capital: ', validateInitialCapital);
}

let maxDeposit = argv.maxDeposit
  ? validateMaxDeposit(argv.maxDeposit, initialCapital, goal)
  : null;
if (maxDeposit === null) {
  maxDeposit = askInput('Maximum monthly deposit: ', validateMaxDeposit, {
    initialCapital,
    goal,
  });
}

// --- Calculation Logic ---
const now = new Date();
const currentYear = now.getFullYear();
const currentMonth = now.getMonth() + 1;
const totalMonths =
  (withdrawDate.year - currentYear) * 12 + (Number(withdrawDate.month) - currentMonth);

// Simulation function: given an integer yield percentage and deposit, compute final capital.
function simulate(initial, yieldPct, deposit, months) {
  let current = initial;
  for (let i = 0; i < months; i++) {
    current = current * (1 + yieldPct / 100) + deposit;
  }
  return current;
}

// Build full scenarios for each deposit from 0 to maxDeposit.
// For each deposit, search for the minimum integer yield (0..100) so that final capital >= goal.
const fullScenarios = [];
for (let deposit = 0; deposit <= maxDeposit; deposit++) {
  for (let yieldPct = 0; yieldPct <= 100; yieldPct++) {
    const finalCapital = simulate(initialCapital, yieldPct, deposit, totalMonths);
    if (finalCapital >= goal) {
      fullScenarios.push({ deposit, yieldPct, finalCapital });
      break;
    }
  }
}

// --- Narrowing the Output ---
// Use a tolerance factor of 1.05: finalCapital must be ≤ goal * 1.05.
// Then, sort by closeness to goal (i.e. finalCapital - goal) and take the top 10.
const upTolerance = 1.05;
const downTolerance = 0.85;
let filtered = fullScenarios.filter(
  s => s.finalCapital <= goal * upTolerance && s.finalCapital >= goal * downTolerance
);

// Always include mandatory rows for deposit=0 and deposit=maxDeposit.
const mandatories = fullScenarios.filter(
  s => s.deposit === 0 || s.deposit === maxDeposit
);
mandatories.forEach(m => {
  if (!filtered.some(s => s.deposit === m.deposit && s.yieldPct === m.yieldPct)) {
    filtered.push(m);
  }
});

// Sort filtered scenarios by overshoot (finalCapital - goal) ascending.
filtered.sort((a, b) => a.finalCapital - goal - (b.finalCapital - goal));

// Now, take the top 10 scenarios that are closest to the goal.
// if (filtered.length > 10) {
//   filtered = filtered.slice(0, 10);
// }

// For display, sort the final list by deposit.
filtered.sort((a, b) => a.deposit - b.deposit);

// Now, re-calculate the best scenario from the final list using a composite metric:
// primary: lower yield percentage, secondary: lower overshoot.
let bestScenario = filtered.reduce((prev, curr) => {
  if (curr.yieldPct < prev.yieldPct) {
    return curr;
  } else if (curr.yieldPct === prev.yieldPct) {
    return curr.finalCapital - goal < prev.finalCapital - goal ? curr : prev;
  } else {
    return prev;
  }
}, filtered[0]);

// --- Formatting ---
function formatCurrency(num) {
  return (
    '$' +
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
      .format(num)
      .replace(/,/g, "'")
  );
}

// ANSI escape codes for background highlighting (green background)
const HIGHLIGHT_START = '\x1b[42m';
const HIGHLIGHT_END = '\x1b[0m';

// --- Output ---
if (filtered.length === 0) {
  console.log('No scenario found that meets the goal with the provided parameters.');
} else {
  console.log('\nScenario Table (Monthly Deposit | Monthly Yield % | Final Capital):');
  console.log('------------------------------------------------------------');
  console.log('Deposit         Yield       Final Capital');
  filtered.forEach(s => {
    let depositStr = formatCurrency(s.deposit).padEnd(15, ' ');
    let yieldStr = (s.yieldPct + '%').padEnd(10, ' ');
    let finalStr = formatCurrency(s.finalCapital);
    let line = `${depositStr} ${yieldStr} ${finalStr}`;
    if (s.deposit === bestScenario.deposit && s.yieldPct === bestScenario.yieldPct) {
      line = HIGHLIGHT_START + line + HIGHLIGHT_END;
    }
    console.log(line);
  });
}

console.log(
  `\nTime horizon: ${totalMonths} months (from ${currentYear}-${String(
    currentMonth
  ).padStart(2, '0')} to ${withdrawDate.year}-${withdrawDate.month})`
);
