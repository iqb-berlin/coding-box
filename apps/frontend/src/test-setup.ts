import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';

setupZoneTestEnv();

// Mock @swimlane/ngx-charts to prevent d3 issues in tests
jest.mock('@swimlane/ngx-charts', () => ({
  NgxChartsModule: {}
}));

// Mock d3-selection to prevent ES module issues in tests
jest.mock('d3-selection', () => ({
  select: jest.fn(() => ({
    append: jest.fn().mockReturnThis(),
    attr: jest.fn().mockReturnThis(),
    style: jest.fn().mockReturnThis(),
    text: jest.fn().mockReturnThis(),
    on: jest.fn().mockReturnThis(),
    remove: jest.fn().mockReturnThis(),
    data: jest.fn().mockReturnThis(),
    enter: jest.fn().mockReturnThis(),
    exit: jest.fn().mockReturnThis(),
    merge: jest.fn().mockReturnThis()
  }))
}));

// Mock d3-transition to prevent ES module issues in tests
jest.mock('d3-transition', () => ({
  transition: jest.fn(() => ({
    duration: jest.fn().mockReturnThis(),
    ease: jest.fn().mockReturnThis(),
    attr: jest.fn().mockReturnThis()
  }))
}));

// Mock jwt-decode
jest.mock('jwt-decode', () => ({
  jwtDecode: jest.fn(() => ({ workspace: '1' }))
}));
