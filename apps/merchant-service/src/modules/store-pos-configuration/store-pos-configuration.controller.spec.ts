import { Test, TestingModule } from '@nestjs/testing';
import { StorePosConfigurationController } from './store-pos-configuration.controller';

describe('StorePosConfigurationController', () => {
  let controller: StorePosConfigurationController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorePosConfigurationController],
    }).compile();

    controller = module.get<StorePosConfigurationController>(
      StorePosConfigurationController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
