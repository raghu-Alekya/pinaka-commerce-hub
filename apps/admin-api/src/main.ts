import '../../../scripts/load-env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: '*',
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: '*',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  const port = Number(process.env.ADMIN_API_PORT || 3009);

  await app.listen(port, '0.0.0.0');

  console.log(`Admin API running on http://localhost:${port}`);

  // Print routes registered by NestJS.
  const server = app.getHttpAdapter().getInstance();

  if (typeof server.printRoutes === 'function') {
    // Fastify
    console.log(server.printRoutes());
  } else {
    // Express: inspect the underlying router.
    const router = server.router ?? server._router;

    if (router?.stack) {
      for (const layer of router.stack) {
        if (layer.route) {
          console.log(
            'ROUTE:',
            Object.keys(layer.route.methods).join(',').toUpperCase(),
            layer.route.path,
          );
        } else if (layer.name === 'router' && layer.handle?.stack) {
          for (const nested of layer.handle.stack) {
            if (nested.route) {
              console.log(
                'ROUTE:',
                Object.keys(nested.route.methods).join(',').toUpperCase(),
                nested.route.path,
              );
            }
          }
        }
      }
    } else {
      console.log('Unable to inspect the Express router.');
    }
  }
}

bootstrap();
