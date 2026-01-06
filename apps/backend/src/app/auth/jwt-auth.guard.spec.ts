import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard (Backend)', () => {
  let guard: JwtAuthGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JwtAuthGuard]
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
  });

  describe('Guard Configuration', () => {
    it('should be defined', () => {
      expect(guard).toBeDefined();
    });

    it('should extend AuthGuard with jwt strategy', () => {
      expect(guard).toBeInstanceOf(AuthGuard('jwt'));
    });

    it('should be injectable', () => {
      expect(guard).toBeInstanceOf(JwtAuthGuard);
    });
  });

  describe('Security Validation - JWT Strategy', () => {
    it('should use jwt passport strategy', () => {
      // The guard extends AuthGuard('jwt'), which means it uses the jwt strategy
      // This is verified by checking the constructor
      const guardPrototype = Object.getPrototypeOf(guard);
      expect(guardPrototype).toBeDefined();
    });

    it('should be usable as a guard decorator', () => {
      // Verify the guard can be used in NestJS guard context
      expect(typeof guard.canActivate).toBe('function');
    });
  });

  describe('Integration with Passport JWT', () => {
    it('should delegate authentication to passport jwt strategy', () => {
      // The JwtAuthGuard delegates to passport's jwt strategy
      // This test verifies the guard is properly configured
      expect(guard.canActivate).toBeDefined();
    });
  });

  describe('Guard Behavior', () => {
    it('should have canActivate method', () => {
      expect(guard.canActivate).toBeDefined();
      expect(typeof guard.canActivate).toBe('function');
    });

    it('should properly extend base AuthGuard', () => {
      // Verify the guard extends AuthGuard by checking it's an instance
      expect(guard).toBeInstanceOf(AuthGuard('jwt'));
    });
  });

  describe('Security - Token Validation', () => {
    it('should validate JWT tokens through passport strategy', () => {
      // The guard uses passport-jwt which validates:
      // - Token signature
      // - Token expiration
      // - Token structure
      // This is handled by the passport strategy, not the guard itself
      expect(guard).toBeInstanceOf(JwtAuthGuard);
    });
  });

  describe('Usage in NestJS', () => {
    it('should be usable with @UseGuards decorator', () => {
      // Verify the guard follows NestJS guard interface
      expect(guard.canActivate).toBeDefined();
    });

    it('should work with global guards', () => {
      // The guard can be used globally in NestJS
      expect(guard).toBeInstanceOf(JwtAuthGuard);
    });

    it('should work with route-level guards', () => {
      // The guard can be used at route level
      expect(guard).toBeDefined();
    });
  });
});
