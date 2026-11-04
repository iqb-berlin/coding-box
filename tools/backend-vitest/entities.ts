const modules = import.meta.glob('../../apps/backend/src/app/database/entities/*.entity.ts', { eager: true });
export const pilotEntities = [...new Set(Object.values(modules).flatMap(Object.values).filter(value => typeof value === 'function'))];
