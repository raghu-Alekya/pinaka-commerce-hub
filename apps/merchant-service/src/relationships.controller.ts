import { Body, CanActivate, Controller, Delete, ExecutionContext, ForbiddenException, Get, Inject, Injectable, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { RELATIONSHIPS, Relationship } from './relationships.config';
import { RelationshipsRepository } from './relationships.repository';

// The existing global session guard authenticates first. These new administration
// routes require OWNER, consistent with the application's privileged owner role.
@Injectable()
export class RelationshipOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (request.user?.role !== 'OWNER') throw new ForbiddenException('Only owners may manage master-data relationships');
    return true;
  }
}

function createController(config: Relationship) {
  @Controller(config.path)
  @UseGuards(RelationshipOwnerGuard)
  class RelationshipController {
    constructor(@Inject(RelationshipsRepository) public readonly repository: RelationshipsRepository) {}
    @Get()
    list(@Param() params: Record<string,string>) { return this.repository.execute(config, 'list', params); }
    @Get(':relatedId')
    get(@Param() params: Record<string,string>) { return this.repository.execute(config, 'get', params, params.relatedId); }
    @Post()
    create(@Param() params: Record<string,string>, @Body() body: unknown) { return this.repository.execute(config, 'create', params, undefined, body); }
    @Put(':relatedId')
    replace(@Param() params: Record<string,string>, @Body() body: unknown) { return this.repository.execute(config, 'replace', params, params.relatedId, body); }
    @Patch(':relatedId')
    patch(@Param() params: Record<string,string>, @Body() body: unknown) { return this.repository.execute(config, 'patch', params, params.relatedId, body); }
    @Delete(':relatedId')
    remove(@Param() params: Record<string,string>) { return this.repository.execute(config, 'delete', params, params.relatedId); }
  }
  Object.defineProperty(RelationshipController, 'name', { value: `${config.name}Controller` });
  return RelationshipController;
}

export const RELATIONSHIP_CONTROLLERS = RELATIONSHIPS.map(createController);
