import '../../../scripts/load-env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.NOTIFICATION_SERVICE_PORT || 3008;
  await app.listen(port);
  console.log(`🚀 Notification Service running on http://localhost:${port}`);
}
bootstrap();
