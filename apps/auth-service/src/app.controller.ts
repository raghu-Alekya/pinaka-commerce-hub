import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateUserDto, UpdateUserDto } from './user.dto';
import {
  CompletePasswordActionDto,
  CreateAccountDto,
  GoogleLoginDto,
  LoginDto,
  RefreshTokenDto,
  RequestPasswordResetDto,
  SignUpDto,
} from './auth.dto';
import { AuthService } from './auth.service';
import { MailService } from './mail.service';
import { UserRepository } from './user.repository';

@Controller()
export class AppController {
  constructor(
    @Inject(UserRepository) private readonly users: UserRepository,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'auth-service',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  readiness() {
    return { status: 'ready' };
  }

  @Get('api/v1/dev/mailbox')
  mockMailbox() {
    if (!this.mail.isMockMode()) throw new NotFoundException();
    const messages = this.mail.getMockMessages();
    return { success: true, count: messages.length, messages };
  }

  @Delete('api/v1/dev/mailbox')
  @HttpCode(HttpStatus.NO_CONTENT)
  clearMockMailbox(): void {
    if (!this.mail.isMockMode()) throw new NotFoundException();
    this.mail.clearMockMessages();
  }

  @Post('api/v1/auth/signup')
  async signUp(@Body() dto: SignUpDto) {
    return { success: true, ...(await this.auth.signUp(dto)) };
  }

  @Post('api/v1/auth/login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return { success: true, ...(await this.auth.login(dto)) };
  }

  @Post('api/v1/auth/refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    return { success: true, ...(await this.auth.refresh(dto)) };
  }

  @Post('api/v1/auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.auth.logout(dto);
  }

  @Post('api/v1/auth/google')
  @HttpCode(HttpStatus.OK)
  async googleLogin(@Body() dto: GoogleLoginDto) {
    return { success: true, ...(await this.auth.loginWithGoogle(dto)) };
  }

  @Post('api/v1/auth/password/reset-request')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    await this.auth.requestPasswordReset(dto.email);
    return {
      success: true,
      message: 'If the account exists, a reset link has been sent',
    };
  }

  @Post('api/v1/auth/password/reset')
  async resetPassword(@Body() dto: CompletePasswordActionDto) {
    return {
      success: true,
      ...(await this.auth.completePasswordAction(dto, 'RESET')),
    };
  }

  @Post('api/v1/auth/invitations/accept')
  async acceptInvitation(@Body() dto: CompletePasswordActionDto) {
    return {
      success: true,
      ...(await this.auth.completePasswordAction(dto, 'INVITE')),
    };
  }

  @Get('accept-invitation')
  @Header('Content-Type', 'text/html; charset=utf-8')
  invitationPage(@Query('token') token = '') {
    return this.passwordActionPage(
      'Accept invitation',
      '/api/v1/auth/invitations/accept',
      token,
    );
  }

  @Get('reset-password')
  @Header('Content-Type', 'text/html; charset=utf-8')
  resetPasswordPage(@Query('token') token = '') {
    return this.passwordActionPage(
      'Reset password',
      '/api/v1/auth/password/reset',
      token,
    );
  }

  @Post('api/pos/account')
  async createPosAccount(
    @Headers('api-key') apiKey: string | undefined,
    @Body() dto: CreateAccountDto,
  ) {
    const configuredKey = process.env.ORDEROUT_POS_API_KEY;
    if (!configuredKey || apiKey !== configuredKey)
      throw new UnauthorizedException('Invalid API key');
    return { success: true, ...(await this.auth.createPosAccount(dto)) };
  }

  @Get('api/v1/users')
  async findAll(@Headers('authorization') authorization?: string) {
    const owner = await this.auth.requireAccountOwner(authorization);
    const users = await this.users.findAll(owner.accountId);
    return { success: true, count: users.length, users };
  }

  @Get('api/v1/users/:id')
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('authorization') authorization?: string,
  ) {
    const owner = await this.auth.requireAccountOwner(authorization);
    const user = await this.users.findById(id, owner.accountId);
    if (!user) throw new NotFoundException(`User '${id}' not found`);
    return { success: true, user };
  }

  @Post('api/v1/users')
  async create(
    @Body() dto: CreateUserDto,
    @Headers('authorization') authorization?: string,
  ) {
    const owner = await this.auth.requireAccountOwner(authorization);
    return {
      success: true,
      user: await this.auth.inviteUser(dto, owner.accountId),
    };
  }

  @Patch('api/v1/users/:id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserDto,
    @Headers('authorization') authorization?: string,
  ) {
    const owner = await this.auth.requireAccountOwner(authorization);
    const user = await this.users.update(id, dto, owner.accountId);
    if (!user) throw new NotFoundException(`User '${id}' not found`);
    return { success: true, user };
  }

  @Delete('api/v1/users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('authorization') authorization?: string,
  ): Promise<void> {
    const owner = await this.auth.requireAccountOwner(authorization);
    if (!(await this.users.delete(id, owner.accountId)))
      throw new NotFoundException(`User '${id}' not found`);
  }

  private passwordActionPage(
    title: string,
    endpoint: string,
    token: string,
  ): string {
    const safeToken = JSON.stringify(token).replace(/</g, '\\u003c');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{font-family:Arial,sans-serif;max-width:420px;margin:70px auto;padding:24px}input,button{box-sizing:border-box;width:100%;padding:16px;margin:10px 0;font-size:16px}button{border:0;border-radius:28px;background:#ff5964;color:white}#message{margin-top:16px}</style></head><body><h1>${title}</h1><p>Enter a password containing at least 8 characters.</p><form id="form"><input id="password" type="password" minlength="8" required placeholder="Password"><button>Continue</button></form><div id="message"></div><script>const token=${safeToken};document.getElementById('form').addEventListener('submit',async(e)=>{e.preventDefault();const message=document.getElementById('message');const response=await fetch('${endpoint}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password:document.getElementById('password').value})});const data=await response.json();message.textContent=response.ok?'Password saved. You can now log in.':(Array.isArray(data.message)?data.message.join(', '):data.message||'Request failed');});</script></body></html>`;
  }
}
