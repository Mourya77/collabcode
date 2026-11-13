export const openApiSpec = {
  "openapi": "3.0.3",
  "info": {
    "title": "CollabCode API",
    "version": "0.3.0",
    "description": "CollabCode REST API (Phase 2). Cookie-based auth: httpOnly cc_access (JWT, 15 min) + rotating cc_refresh (7 days, SHA-256 hash stored server-side). CSRF: double-submit \u2014 send the cc_csrf cookie value as the x-csrf-token header on every mutating request. Errors use the envelope {success:false, data:null, error:{code,message}, requestId}. Non-members always receive 404 for project resources so existence is not leaked."
  },
  "servers": [
    {
      "url": "http://localhost:4000"
    }
  ],
  "tags": [
    {
      "name": "Health"
    },
    {
      "name": "Auth"
    },
    {
      "name": "Users"
    },
    {
      "name": "Projects"
    },
    {
      "name": "Members"
    },
    {
      "name": "Files"
    },
    {
      "name": "Versions"
    },
    {
      "name": "Collaboration"
    },
    {
      "name": "Executions"
    }
  ],
  "paths": {
    "/health": {
      "get": {
        "summary": "Service health (raw HealthStatus, unversioned probe)",
        "tags": [
          "Health"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/HealthStatus"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/health": {
      "get": {
        "summary": "Service health (versioned alias)",
        "tags": [
          "Health"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/HealthStatus"
                }
              }
            }
          }
        }
      }
    },
    "/api/auth/csrf": {
      "get": {
        "summary": "Get/issue the CSRF double-submit token (sets cc_csrf cookie)",
        "tags": [
          "Auth"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "type": "object",
                      "properties": {
                        "csrfToken": {
                          "type": "string"
                        }
                      }
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/auth/register": {
      "post": {
        "summary": "Register a new account; sets session cookies",
        "tags": [
          "Auth"
        ],
        "parameters": [
          {
            "name": "x-csrf-token",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Must equal the cc_csrf cookie (double-submit). Obtain via GET /api/auth/csrf or any auth response."
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/RegisterInput"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Created; cookies set",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "$ref": "#/components/schemas/User"
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Validation error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "409": {
            "description": "Email already registered",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/auth/login": {
      "post": {
        "summary": "Log in; sets session cookies",
        "tags": [
          "Auth"
        ],
        "parameters": [
          {
            "name": "x-csrf-token",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Must equal the cc_csrf cookie (double-submit). Obtain via GET /api/auth/csrf or any auth response."
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/LoginInput"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "OK; cookies set",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "$ref": "#/components/schemas/User"
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/auth/refresh": {
      "post": {
        "summary": "Rotate the refresh token and issue a new access token",
        "tags": [
          "Auth"
        ],
        "parameters": [
          {
            "name": "x-csrf-token",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Must equal the cc_csrf cookie (double-submit). Obtain via GET /api/auth/csrf or any auth response."
          }
        ],
        "responses": {
          "200": {
            "description": "OK; new cookies set",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "$ref": "#/components/schemas/User"
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Missing/invalid/reused refresh token (reuse revokes all sessions)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/auth/logout": {
      "post": {
        "summary": "Log out: revokes the refresh token server-side and clears cookies",
        "tags": [
          "Auth"
        ],
        "parameters": [
          {
            "name": "x-csrf-token",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Must equal the cc_csrf cookie (double-submit). Obtain via GET /api/auth/csrf or any auth response."
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "type": "object"
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/auth/me": {
      "get": {
        "summary": "Current user (from the access cookie)",
        "tags": [
          "Auth"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "$ref": "#/components/schemas/User"
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Not authenticated",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/users/me": {
      "get": {
        "summary": "Current user's profile",
        "tags": [
          "Users"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "$ref": "#/components/schemas/User"
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Not authenticated",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      },
      "patch": {
        "summary": "Update profile (name, avatarUrl)",
        "tags": [
          "Users"
        ],
        "parameters": [
          {
            "name": "x-csrf-token",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Must equal the cc_csrf cookie (double-submit). Obtain via GET /api/auth/csrf or any auth response."
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string"
                  },
                  "avatarUrl": {
                    "type": "string",
                    "nullable": true
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "$ref": "#/components/schemas/User"
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Validation error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Not authenticated",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/projects": {
      "post": {
        "summary": "Create a project (seeds welcome.md + src/main.ts, caller becomes OWNER)",
        "tags": [
          "Projects"
        ],
        "parameters": [
          {
            "name": "x-csrf-token",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Must equal the cc_csrf cookie (double-submit). Obtain via GET /api/auth/csrf or any auth response."
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "name"
                ],
                "properties": {
                  "name": {
                    "type": "string"
                  },
                  "description": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Created",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "$ref": "#/components/schemas/Project"
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Validation error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Not authenticated",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      },
      "get": {
        "summary": "List projects the caller belongs to (search + pagination)",
        "tags": [
          "Projects"
        ],
        "parameters": [
          {
            "name": "search",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "page",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 1
            }
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 20,
              "maximum": 100
            }
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "type": "object",
                      "properties": {
                        "items": {
                          "type": "array",
                          "items": {
                            "$ref": "#/components/schemas/Project"
                          }
                        },
                        "total": {
                          "type": "integer"
                        },
                        "page": {
                          "type": "integer"
                        },
                        "limit": {
                          "type": "integer"
                        }
                      }
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/projects/{projectId}": {
      "get": {
        "summary": "Get a project (members only; 404 for non-members)",
        "tags": [
          "Projects"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "$ref": "#/components/schemas/Project"
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "404": {
            "description": "Not found / not a member",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      },
      "patch": {
        "summary": "Update project metadata (OWNER only)",
        "tags": [
          "Projects"
        ],
        "parameters": [
          {
            "name": "x-csrf-token",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Must equal the cc_csrf cookie (double-submit). Obtain via GET /api/auth/csrf or any auth response."
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string"
                  },
                  "description": {
                    "type": "string",
                    "nullable": true
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "$ref": "#/components/schemas/Project"
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "403": {
            "description": "Not the owner",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "404": {
            "description": "Not found / not a member",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      },
      "delete": {
        "summary": "Delete a project (OWNER only; cascades members/files/versions)",
        "tags": [
          "Projects"
        ],
        "parameters": [
          {
            "name": "x-csrf-token",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Must equal the cc_csrf cookie (double-submit). Obtain via GET /api/auth/csrf or any auth response."
          }
        ],
        "responses": {
          "200": {
            "description": "Deleted",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "type": "object"
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "403": {
            "description": "Not the owner",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "404": {
            "description": "Not found / not a member",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/projects/{projectId}/invitations": {
      "post": {
        "summary": "Create a project invitation (OWNER only, Phase 4). Nobody becomes a member until they ACCEPT via POST /api/invitations/{token}/accept. Works for registered and unregistered emails. The response includes a development-mode inviteUrl (email delivery is not bundled; see the mailer docs).",
        "tags": [
          "Invitations"
        ],
        "parameters": [
          {
            "name": "x-csrf-token",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Must equal the cc_csrf cookie (double-submit). Obtain via GET /api/auth/csrf or any auth response."
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "email",
                  "role"
                ],
                "properties": {
                  "email": {
                    "type": "string",
                    "format": "email"
                  },
                  "role": {
                    "type": "string",
                    "enum": [
                      "EDITOR",
                      "VIEWER"
                    ]
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Invitation created (PENDING). data = invitation + inviteUrl + invitedUserExists.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "type": "object",
                      "properties": {
                        "id": { "type": "string", "format": "uuid" },
                        "projectId": { "type": "string", "format": "uuid" },
                        "email": { "type": "string", "format": "email" },
                        "role": { "type": "string", "enum": ["EDITOR", "VIEWER"] },
                        "status": { "type": "string", "enum": ["PENDING", "ACCEPTED", "DECLINED", "REVOKED", "EXPIRED"] },
                        "invitedBy": {
                          "type": "object",
                          "properties": {
                            "id": { "type": "string", "format": "uuid" },
                            "name": { "type": "string" },
                            "email": { "type": "string", "format": "email" }
                          }
                        },
                        "expiresAt": { "type": "string", "format": "date-time" },
                        "createdAt": { "type": "string", "format": "date-time" },
                        "updatedAt": { "type": "string", "format": "date-time" }
                      }
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Validation error, or inviting your own email",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "403": {
            "description": "Caller is a member but not the OWNER",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "404": {
            "description": "Not found / not a member",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "409": {
            "description": "CONFLICT (already a member) or DUPLICATE_INVITATION (a PENDING invitation already exists for this email)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      },
      "get": {
        "summary": "List the project's invitations, newest first (OWNER only). Optional ?status=PENDING|ACCEPTED|DECLINED|REVOKED|EXPIRED filter. Expired PENDING invitations are reported as EXPIRED (lazy expiry).",
        "tags": [
          "Invitations"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": { "type": "array", "items": {
                      "type": "object",
                      "properties": {
                        "id": { "type": "string", "format": "uuid" },
                        "projectId": { "type": "string", "format": "uuid" },
                        "email": { "type": "string", "format": "email" },
                        "role": { "type": "string", "enum": ["EDITOR", "VIEWER"] },
                        "status": { "type": "string", "enum": ["PENDING", "ACCEPTED", "DECLINED", "REVOKED", "EXPIRED"] },
                        "invitedBy": {
                          "type": "object",
                          "properties": {
                            "id": { "type": "string", "format": "uuid" },
                            "name": { "type": "string" },
                            "email": { "type": "string", "format": "email" }
                          }
                        },
                        "expiresAt": { "type": "string", "format": "date-time" },
                        "createdAt": { "type": "string", "format": "date-time" },
                        "updatedAt": { "type": "string", "format": "date-time" }
                      }
                    } },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "403": {
            "description": "Caller is a member but not the OWNER",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "404": {
            "description": "Not found / not a member",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/projects/{projectId}/invitations/{invitationId}": {
      "delete": {
        "summary": "Revoke a PENDING invitation (OWNER only). Settled invitations return 409.",
        "tags": [
          "Invitations"
        ],
        "parameters": [
          {
            "name": "x-csrf-token",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Must equal the cc_csrf cookie (double-submit). Obtain via GET /api/auth/csrf or any auth response."
          }
        ],
        "responses": {
          "200": {
            "description": "Invitation revoked",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "type": "object",
                      "properties": {
                        "id": { "type": "string", "format": "uuid" },
                        "projectId": { "type": "string", "format": "uuid" },
                        "email": { "type": "string", "format": "email" },
                        "role": { "type": "string", "enum": ["EDITOR", "VIEWER"] },
                        "status": { "type": "string", "enum": ["PENDING", "ACCEPTED", "DECLINED", "REVOKED", "EXPIRED"] },
                        "invitedBy": {
                          "type": "object",
                          "properties": {
                            "id": { "type": "string", "format": "uuid" },
                            "name": { "type": "string" },
                            "email": { "type": "string", "format": "email" }
                          }
                        },
                        "expiresAt": { "type": "string", "format": "date-time" },
                        "createdAt": { "type": "string", "format": "date-time" },
                        "updatedAt": { "type": "string", "format": "date-time" }
                      }
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "404": {
            "description": "Invitation not in this project / not a member",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "409": {
            "description": "Invitation is not PENDING",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/invitations/mine": {
      "get": {
        "summary": "Invitations addressed to the signed-in user's email (PENDING and unexpired).",
        "tags": [
          "Invitations"
        ],
        "responses": {
          "200": {
            "description": "OK — array of {id, projectId, projectName, inviterName, role, status, expiresAt, createdAt}",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": { "type": "array", "items": { "type": "object" } },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Authentication required",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/invitations/by-id/{invitationId}/accept": {
      "post": {
        "summary": "Accept an invitation by id (dashboard flow — same email-binding, expiry and settled-state rules as the token flow; the raw token is never stored, so /mine cannot rebuild invite links).",
        "tags": [
          "Invitations"
        ],
        "responses": {
          "200": {
            "description": "Accepted — data = {project} summary"
          },
          "403": {
            "description": "INVITATION_EMAIL_MISMATCH"
          },
          "404": {
            "description": "Unknown invitation id"
          },
          "409": {
            "description": "Invitation already settled, or already a member"
          },
          "410": {
            "description": "INVITATION_EXPIRED"
          }
        }
      }
    },
    "/api/invitations/by-id/{invitationId}/decline": {
      "post": {
        "summary": "Decline an invitation by id (dashboard flow; same rules as accept-by-id).",
        "tags": [
          "Invitations"
        ],
        "responses": {
          "200": {
            "description": "Declined — data = the invitation with status DECLINED"
          },
          "403": {
            "description": "INVITATION_EMAIL_MISMATCH"
          },
          "404": {
            "description": "Unknown invitation id"
          },
          "409": {
            "description": "Invitation already settled"
          },
          "410": {
            "description": "INVITATION_EXPIRED"
          }
        }
      }
    },
    "/api/invitations/{token}": {
      "get": {
        "summary": "PUBLIC invitation preview by raw token (looked up by SHA-256 hash). Returns only {projectName, inviterName, role, status, expiresAt} — no emails or member lists.",
        "tags": [
          "Invitations"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": { "type": "object", "properties": { "projectName": { "type": "string" }, "inviterName": { "type": "string" }, "role": { "type": "string" }, "status": { "type": "string" }, "expiresAt": { "type": "string", "format": "date-time" } } },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "404": {
            "description": "Unknown token",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/invitations/{token}/accept": {
      "post": {
        "summary": "Accept an invitation. The signed-in user's email MUST equal the invited email (tokens are not transferable). Creates the membership in a transaction and returns the project summary.",
        "tags": [
          "Invitations"
        ],
        "parameters": [
          {
            "name": "x-csrf-token",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Must equal the cc_csrf cookie (double-submit). Obtain via GET /api/auth/csrf or any auth response."
          }
        ],
        "responses": {
          "200": {
            "description": "Accepted — data = {project} summary (with the member's role)",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": { "type": "object", "properties": { "project": { "$ref": "#/components/schemas/Project" } } },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "403": {
            "description": "INVITATION_EMAIL_MISMATCH — signed in with a different email than invited",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "404": {
            "description": "Unknown token",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "409": {
            "description": "Invitation already settled, or already a member",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "410": {
            "description": "INVITATION_EXPIRED — past expiresAt (the invitation is persisted as EXPIRED)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/invitations/{token}/decline": {
      "post": {
        "summary": "Decline an invitation (same email-match rule as accept).",
        "tags": [
          "Invitations"
        ],
        "parameters": [
          {
            "name": "x-csrf-token",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Must equal the cc_csrf cookie (double-submit). Obtain via GET /api/auth/csrf or any auth response."
          }
        ],
        "responses": {
          "200": {
            "description": "Declined — data = {status: DECLINED}",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": { "type": "object", "properties": { "status": { "type": "string", "enum": ["DECLINED"] } } },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "403": {
            "description": "INVITATION_EMAIL_MISMATCH",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "404": {
            "description": "Unknown token",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "409": {
            "description": "Invitation already settled",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "410": {
            "description": "INVITATION_EXPIRED",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/projects/{projectId}/messages": {
      "get": {
        "summary": "Chat history (any member; non-members 404). Newest-first cursor pagination: ?limit=50 (1..100) & ?cursor=<messageId> returns the page older than the cursor plus nextCursor. Sending is WebSocket-only (wss /api/chat/ws).",
        "tags": [
          "Chat"
        ],
        "responses": {
          "200": {
            "description": "OK — data = {messages: [{id, projectId, content, createdAt, sender: {id, name, avatarUrl}}], nextCursor}",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": { "type": "object" },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Unknown cursor",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "404": {
            "description": "Not found / not a member",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/projects/{projectId}/presence": {
      "get": {
        "summary": "Workspace presence (any member): {online: [{userId, name, activeFileId, lastSeenAt}], members: [{userId, name, email, avatarUrl, role, online, activeFileId, lastSeenAt}]}. In-memory, single-process registry (Redis arrives in Phase 6).",
        "tags": [
          "Chat"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": { "type": "object" },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "404": {
            "description": "Not found / not a member",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/projects/{projectId}/members": {
      "get": {
        "summary": "List project members (any member)",
        "tags": [
          "Members"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/Member"
                      }
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "404": {
            "description": "Not found / not a member",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/projects/{projectId}/members/{userId}": {
      "patch": {
        "summary": "Change a member's role (OWNER only; never your own; last OWNER cannot be demoted)",
        "tags": [
          "Members"
        ],
        "parameters": [
          {
            "name": "x-csrf-token",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Must equal the cc_csrf cookie (double-submit). Obtain via GET /api/auth/csrf or any auth response."
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "role"
                ],
                "properties": {
                  "role": {
                    "type": "string",
                    "enum": [
                      "OWNER",
                      "EDITOR",
                      "VIEWER"
                    ]
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "$ref": "#/components/schemas/Member"
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "403": {
            "description": "Self role change / last owner / not owner",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "404": {
            "description": "Member not found",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      },
      "delete": {
        "summary": "Remove a member (OWNER, or yourself to leave; last OWNER cannot leave)",
        "tags": [
          "Members"
        ],
        "parameters": [
          {
            "name": "x-csrf-token",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Must equal the cc_csrf cookie (double-submit). Obtain via GET /api/auth/csrf or any auth response."
          }
        ],
        "responses": {
          "200": {
            "description": "Removed",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "type": "object"
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "403": {
            "description": "Not allowed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "404": {
            "description": "Member not found",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/projects/{projectId}/files": {
      "post": {
        "summary": "Create a file or folder (EDITOR+)",
        "tags": [
          "Files"
        ],
        "parameters": [
          {
            "name": "x-csrf-token",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Must equal the cc_csrf cookie (double-submit). Obtain via GET /api/auth/csrf or any auth response."
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "name",
                  "type"
                ],
                "properties": {
                  "name": {
                    "type": "string"
                  },
                  "type": {
                    "type": "string",
                    "enum": [
                      "FILE",
                      "FOLDER"
                    ]
                  },
                  "parentId": {
                    "type": "string",
                    "nullable": true
                  },
                  "content": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Created",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "$ref": "#/components/schemas/File"
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Invalid name/path or parent",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "403": {
            "description": "VIEWER is read-only",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "409": {
            "description": "Path already exists",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      },
      "get": {
        "summary": "List all files of a project (flat, with parentId; VIEWER+)",
        "tags": [
          "Files"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/File"
                      }
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "404": {
            "description": "Not found / not a member",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/files/{fileId}": {
      "get": {
        "summary": "Get a file; FILEs include latest content (VIEWER+ of its project)",
        "tags": [
          "Files"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "$ref": "#/components/schemas/File"
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "404": {
            "description": "Not found / not a member",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      },
      "patch": {
        "summary": "Rename/move a file or folder, and/or save content as a new version (EDITOR+)",
        "tags": [
          "Files"
        ],
        "parameters": [
          {
            "name": "x-csrf-token",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Must equal the cc_csrf cookie (double-submit). Obtain via GET /api/auth/csrf or any auth response."
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string"
                  },
                  "parentId": {
                    "type": "string",
                    "nullable": true
                  },
                  "content": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "$ref": "#/components/schemas/File"
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Invalid name/move/content",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "403": {
            "description": "VIEWER is read-only",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "409": {
            "description": "Path already exists",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      },
      "delete": {
        "summary": "Delete a file or folder (EDITOR+; folders cascade)",
        "tags": [
          "Files"
        ],
        "parameters": [
          {
            "name": "x-csrf-token",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Must equal the cc_csrf cookie (double-submit). Obtain via GET /api/auth/csrf or any auth response."
          }
        ],
        "responses": {
          "200": {
            "description": "Deleted",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "type": "object"
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "403": {
            "description": "VIEWER is read-only",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "404": {
            "description": "Not found / not a member",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/files/{fileId}/versions": {
      "get": {
        "summary": "List version metadata for a file (VIEWER+)",
        "tags": [
          "Versions"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/VersionMeta"
                      }
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "404": {
            "description": "Not found / not a member",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      },
      "post": {
        "summary": "Save an explicit new version (EDITOR+)",
        "tags": [
          "Versions"
        ],
        "parameters": [
          {
            "name": "x-csrf-token",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Must equal the cc_csrf cookie (double-submit). Obtain via GET /api/auth/csrf or any auth response."
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "content"
                ],
                "properties": {
                  "content": {
                    "type": "string"
                  },
                  "label": {
                    "type": "string",
                    "description": "Optional snapshot label (Phase 6). When present the version is stored with source SNAPSHOT; otherwise source SAVE."
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Version saved; returns the file",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "$ref": "#/components/schemas/File"
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "403": {
            "description": "VIEWER is read-only",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/files/{fileId}/versions/{versionId}": {
      "get": {
        "summary": "Get one version with its content (VIEWER+)",
        "tags": [
          "Versions"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "allOf": [
                        {
                          "$ref": "#/components/schemas/VersionMeta"
                        },
                        {
                          "type": "object",
                          "properties": {
                            "content": {
                              "type": "string"
                            }
                          }
                        }
                      ]
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "404": {
            "description": "Version not found",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/files/{fileId}/versions/{versionId}/restore": {
      "post": {
        "summary": "Restore a version through the live document (EDITOR+, Phase 6). Snapshots the caller's current content first, then applies the version via the collaboration server; 502 COLLAB_UNAVAILABLE (nothing applied) when the collab server is unreachable.",
        "tags": [
          "Versions"
        ],
        "parameters": [
          {
            "name": "x-csrf-token",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Must equal the cc_csrf cookie (double-submit)."
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "currentContent"
                ],
                "properties": {
                  "currentContent": {
                    "type": "string",
                    "description": "The caller's current live editor content; stored as the pre-restore snapshot."
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Restored through the live document",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "$ref": "#/components/schemas/RestoreResult"
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "403": {
            "description": "VIEWER is read-only",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "404": {
            "description": "File/version not found or not a member",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "502": {
            "description": "COLLAB_UNAVAILABLE — collaboration server unreachable; the document was not modified",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/collab/token": {
      "post": {
        "summary": "Issue a collaboration token (Phase 3) for a project the caller belongs to",
        "tags": [
          "Collaboration"
        ],
        "parameters": [
          {
            "name": "x-csrf-token",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Must equal the cc_csrf cookie (double-submit). Obtain via GET /api/auth/csrf or any auth response."
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CollabTokenInput"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "$ref": "#/components/schemas/CollabToken"
                    },
                    "error": {
                      "nullable": true
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Not authenticated",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "404": {
            "description": "Project not found (also returned for non-members so existence is not leaked)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/projects/{projectId}/executions": {
      "post": {
        "summary": "Run project code in the isolated execution service (Phase 5). EDITOR role or above; the language is derived server-side from the entry file's extension (.js/.mjs/.cjs, .py, .cpp/.cc/.cxx). Blocks until the run finishes (bounded by the service timeout) and returns the persisted execution.",
        "tags": [
          "Executions"
        ],
        "parameters": [
          {
            "name": "projectId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          },
          {
            "name": "x-csrf-token",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Must equal the cc_csrf cookie (double-submit)."
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CreateExecutionInput"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Execution finished (any terminal status) and was persisted",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ExecutionEnvelope"
                }
              }
            }
          },
          "400": {
            "description": "Unsupported entry-file language (UNSUPPORTED_LANGUAGE) or invalid body",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "403": {
            "description": "VIEWER role may not execute code",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "404": {
            "description": "Project or file not found (also for non-members)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "429": {
            "description": "Execution rate limit (RATE_LIMITED) or too many in flight for this user (TOO_MANY_RUNNING)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "503": {
            "description": "Code execution is not enabled on this deployment (EXECUTION_DISABLED) — no EXECUTION_SERVICE_URL is configured; no execution record is created",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/executions/{executionId}": {
      "get": {
        "summary": "Read one execution. Only its creator may read it; anyone else gets 404.",
        "tags": [
          "Executions"
        ],
        "parameters": [
          {
            "name": "executionId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ExecutionEnvelope"
                }
              }
            }
          },
          "404": {
            "description": "Execution not found (also for executions created by other users)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/executions/{executionId}/cancel": {
      "post": {
        "summary": "Cancel a QUEUED/RUNNING execution (creator only). Aborts the run in the execution service and marks the execution CANCELLED.",
        "tags": [
          "Executions"
        ],
        "parameters": [
          {
            "name": "executionId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          },
          {
            "name": "x-csrf-token",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Must equal the cc_csrf cookie (double-submit)."
          }
        ],
        "responses": {
          "200": {
            "description": "Execution cancelled",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ExecutionEnvelope"
                }
              }
            }
          },
          "404": {
            "description": "Execution not found (also for executions created by other users)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "409": {
            "description": "Execution already terminal (EXECUTION_NOT_RUNNING)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    }
  },
  "components": {
    "securitySchemes": {
      "cookieAuth": {
        "type": "apiKey",
        "in": "cookie",
        "name": "cc_access"
      }
    },
    "schemas": {
      "HealthStatus": {
        "type": "object",
        "properties": {
          "status": {
            "type": "string"
          },
          "service": {
            "type": "string"
          },
          "version": {
            "type": "string"
          },
          "timestamp": {
            "type": "string",
            "format": "date-time"
          },
          "uptime": {
            "type": "number"
          }
        }
      },
      "ErrorEnvelope": {
        "type": "object",
        "properties": {
          "success": {
            "type": "boolean",
            "example": false
          },
          "data": {
            "nullable": true
          },
          "error": {
            "type": "object",
            "properties": {
              "code": {
                "type": "string",
                "enum": [
                  "VALIDATION_ERROR",
                  "UNAUTHORIZED",
                  "FORBIDDEN",
                  "NOT_FOUND",
                  "USER_NOT_FOUND",
                  "CONFLICT",
                  "RATE_LIMITED",
                  "INTERNAL"
                ]
              },
              "message": {
                "type": "string"
              }
            }
          },
          "requestId": {
            "type": "string"
          }
        }
      },
      "User": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "name": {
            "type": "string"
          },
          "email": {
            "type": "string",
            "format": "email"
          },
          "avatarUrl": {
            "type": "string",
            "nullable": true
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "RegisterInput": {
        "type": "object",
        "required": [
          "name",
          "email",
          "password"
        ],
        "properties": {
          "name": {
            "type": "string"
          },
          "email": {
            "type": "string",
            "format": "email"
          },
          "password": {
            "type": "string",
            "minLength": 8
          }
        }
      },
      "LoginInput": {
        "type": "object",
        "required": [
          "email",
          "password"
        ],
        "properties": {
          "email": {
            "type": "string",
            "format": "email"
          },
          "password": {
            "type": "string"
          }
        }
      },
      "Project": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "name": {
            "type": "string"
          },
          "description": {
            "type": "string",
            "nullable": true
          },
          "ownerId": {
            "type": "string",
            "format": "uuid"
          },
          "role": {
            "type": "string",
            "enum": [
              "OWNER",
              "EDITOR",
              "VIEWER"
            ]
          },
          "fileCount": {
            "type": "integer"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "Member": {
        "type": "object",
        "properties": {
          "userId": {
            "type": "string",
            "format": "uuid"
          },
          "role": {
            "type": "string",
            "enum": [
              "OWNER",
              "EDITOR",
              "VIEWER"
            ]
          },
          "joinedAt": {
            "type": "string",
            "format": "date-time"
          },
          "user": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string"
              },
              "email": {
                "type": "string"
              },
              "avatarUrl": {
                "type": "string",
                "nullable": true
              }
            }
          }
        }
      },
      "File": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "projectId": {
            "type": "string",
            "format": "uuid"
          },
          "parentId": {
            "type": "string",
            "nullable": true
          },
          "name": {
            "type": "string"
          },
          "type": {
            "type": "string",
            "enum": [
              "FILE",
              "FOLDER"
            ]
          },
          "path": {
            "type": "string"
          },
          "content": {
            "type": "string",
            "nullable": true
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "VersionMeta": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "fileId": {
            "type": "string",
            "format": "uuid"
          },
          "createdBy": {
            "type": "string",
            "format": "uuid"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "source": {
            "type": "string",
            "enum": [
              "SAVE",
              "SNAPSHOT",
              "RESTORE",
              "AUTOSAVE"
            ],
            "description": "Phase 6: how this version came to exist."
          },
          "label": {
            "type": "string",
            "nullable": true
          },
          "author": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid"
              },
              "name": {
                "type": "string"
              }
            }
          },
          "sizeBytes": {
            "type": "integer",
            "description": "Content length in characters. List responses never include the content itself."
          }
        }
      },
      "RestoreResult": {
        "type": "object",
        "properties": {
          "restoredVersionId": {
            "type": "string",
            "format": "uuid"
          },
          "snapshotVersionId": {
            "type": "string",
            "format": "uuid",
            "description": "The pre-restore snapshot of the caller's live content (source SNAPSHOT, label 'Before restore')."
          }
        }
      },
      "CollabTokenInput": {
        "type": "object",
        "required": [
          "projectId"
        ],
        "properties": {
          "projectId": {
            "type": "string",
            "format": "uuid"
          }
        }
      },
      "CollabToken": {
        "type": "object",
        "properties": {
          "token": {
            "type": "string",
            "description": "Short-lived JWT (10 min, audience \"collab\") for the collaboration WebSocket server."
          },
          "user": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid"
              },
              "name": {
                "type": "string"
              },
              "email": {
                "type": "string",
                "format": "email"
              }
            }
          },
          "role": {
            "type": "string",
            "enum": [
              "OWNER",
              "EDITOR",
              "VIEWER"
            ]
          },
          "expiresAt": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "CreateExecutionInput": {
        "type": "object",
        "required": [
          "entryFileId"
        ],
        "properties": {
          "entryFileId": {
            "type": "string",
            "format": "uuid",
            "description": "The project file to run. Language is derived from its extension."
          },
          "files": {
            "type": "array",
            "maxItems": 50,
            "description": "Optional explicit file set. Each fileId must belong to the project; content (live editor state) is optional — omitted content is loaded from the file's latest saved version. If files is omitted entirely, all project files are sent.",
            "items": {
              "type": "object",
              "required": [
                "fileId"
              ],
              "properties": {
                "fileId": {
                  "type": "string",
                  "format": "uuid"
                },
                "content": {
                  "type": "string"
                }
              }
            }
          }
        }
      },
      "Execution": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "projectId": {
            "type": "string",
            "format": "uuid"
          },
          "userId": {
            "type": "string",
            "format": "uuid"
          },
          "language": {
            "type": "string",
            "enum": [
              "javascript",
              "python",
              "cpp"
            ]
          },
          "status": {
            "type": "string",
            "enum": [
              "QUEUED",
              "RUNNING",
              "COMPLETED",
              "FAILED",
              "TIMEOUT",
              "CANCELLED"
            ]
          },
          "stdout": {
            "type": "string",
            "nullable": true
          },
          "stderr": {
            "type": "string",
            "nullable": true
          },
          "exitCode": {
            "type": "integer",
            "nullable": true
          },
          "executionTimeMs": {
            "type": "number",
            "nullable": true
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "ExecutionEnvelope": {
        "type": "object",
        "properties": {
          "success": {
            "type": "boolean"
          },
          "data": {
            "$ref": "#/components/schemas/Execution"
          },
          "error": {
            "nullable": true
          },
          "requestId": {
            "type": "string"
          }
        }
      }
    }
  },
  "security": [
    {
      "cookieAuth": []
    }
  ]
} as const;
