import { Module } from '@nestjs/common';
import { RoleTemplateController } from './role-template.controller';
import { MerchantRoleTemplateController } from './merchant-role-template.controller';
import { RoleTemplateFeatureAccessController } from './role-template-mapping.controller';
import { RoleController } from './role.controller';
import { RoleTemplateRepository } from './role-template.repository';
import { MerchantModule } from '../../merchant/merchant.module';
import { RelationshipsModule } from '../../shared/relationships.module';

@Module({
  imports: [MerchantModule, RelationshipsModule],
  controllers: [
    RoleController,
    RoleTemplateController,
    MerchantRoleTemplateController,
    RoleTemplateFeatureAccessController,
  ],
  providers: [RoleTemplateRepository],
  exports: [RoleTemplateRepository],
})
export class RoleTemplatesModule {}
