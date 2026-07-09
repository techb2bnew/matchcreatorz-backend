'use strict';
const swaggerJsdoc = require('swagger-jsdoc');
const env          = require('./env');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title:       'MatchCreatorz API',
      version:     '1.0.0',
      description: 'MatchCreatorz REST API documentation',
    },
    servers: [
      { url: `http://localhost:${env.PORT}`, description: 'Development server' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type:         'http',
          scheme:       'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: [
    './src/controllers/*.js',
    './src/controllers/**/*.js',
    './src/routes/*.js',
  ],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
