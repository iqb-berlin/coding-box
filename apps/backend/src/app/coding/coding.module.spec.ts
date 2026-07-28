import { MODULE_METADATA } from '@nestjs/common/constants';
import { CodingAggregationPeerService } from '../database/services/coding/coding-aggregation-peer.service';
import { CodingModule } from './coding.module';

describe('CodingModule', () => {
  it('exports CodingAggregationPeerService for importing modules', () => {
    const exportedProviders = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      CodingModule
    ) as unknown[];

    expect(exportedProviders).toContain(CodingAggregationPeerService);
  });
});
