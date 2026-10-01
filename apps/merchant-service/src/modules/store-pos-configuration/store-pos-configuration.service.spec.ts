import { Test, TestingModule } from '@nestjs/testing';
import { StorePosConfigurationService } from './store-pos-configuration.service';

describe('StorePosConfigurationService', () => {
  let service: StorePosConfigurationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StorePosConfigurationService],
    }).compile();

    service = module.get<StorePosConfigurationService>(
      StorePosConfigurationService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
