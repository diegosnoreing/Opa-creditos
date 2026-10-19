/* =====================================================================
   Modulo de creditos - Esquema SQL Server 2019+
   Idempotente: se puede ejecutar varias veces sin error.
   Uso manual (SSMS): abrir y ejecutar completo.
   Uso automatico:    npm run db:init (desde backend/)
   ===================================================================== */

IF DB_ID('OpaCreditos') IS NULL
    CREATE DATABASE OpaCreditos;
GO

USE OpaCreditos;
GO

-- Requeridos para crear/usar indices filtrados.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* ---------------------------------------------------------------------
   Asociados
   - PK surrogate (INT IDENTITY): estable y pequena para las FK.
   - Identificacion es la llave natural: UNIQUE, no PK, porque un documento
     puede corregirse y no debe arrastrar cambios en las tablas hijas.
   --------------------------------------------------------------------- */
IF OBJECT_ID('dbo.Asociados', 'U') IS NULL
CREATE TABLE dbo.Asociados (
    Id                INT IDENTITY(1,1)  NOT NULL,
    Identificacion    VARCHAR(20)        NOT NULL,
    Nombre            NVARCHAR(150)      NOT NULL,
    FechaCreacion     DATETIME2(3)       NOT NULL CONSTRAINT DF_Asociados_FechaCreacion DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Asociados PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT UQ_Asociados_Identificacion UNIQUE (Identificacion),
    CONSTRAINT CK_Asociados_Identificacion CHECK (LEN(LTRIM(RTRIM(Identificacion))) > 0),
    CONSTRAINT CK_Asociados_Nombre CHECK (LEN(LTRIM(RTRIM(Nombre))) > 0)
);
GO

/* ---------------------------------------------------------------------
   Usuarios (autenticacion de la API)
   - Solo se guarda el hash bcrypt, nunca la clave.
   - Rol restringido por CHECK: ADMIN o ANALISTA.
   --------------------------------------------------------------------- */
IF OBJECT_ID('dbo.Usuarios', 'U') IS NULL
CREATE TABLE dbo.Usuarios (
    Id             INT IDENTITY(1,1) NOT NULL,
    Username       VARCHAR(50)       NOT NULL,
    PasswordHash   VARCHAR(100)      NOT NULL,
    Rol            VARCHAR(20)       NOT NULL,
    Activo         BIT               NOT NULL CONSTRAINT DF_Usuarios_Activo DEFAULT 1,
    FechaCreacion  DATETIME2(3)      NOT NULL CONSTRAINT DF_Usuarios_FechaCreacion DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Usuarios PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT UQ_Usuarios_Username UNIQUE (Username),
    CONSTRAINT CK_Usuarios_Rol CHECK (Rol IN ('ADMIN','ANALISTA'))
);
GO

/* ---------------------------------------------------------------------
   Secuencia del numero de credito (CR-AAAA-000123)
   - Atomica y sin bloqueos entre transacciones; MAX()+1 duplica bajo
     concurrencia.
   --------------------------------------------------------------------- */
IF OBJECT_ID('dbo.SeqNumeroCredito', 'SO') IS NULL
    CREATE SEQUENCE dbo.SeqNumeroCredito AS INT START WITH 1 INCREMENT BY 1;
GO

/* ---------------------------------------------------------------------
   Creditos
   - Dinero DECIMAL(18,2). Tasa DECIMAL(7,4): porcentaje, ej. 1.5000.
   - Estado como VARCHAR + CHECK: legible al consultar y auditar. Las
     TRANSICIONES validas viven en la capa de servicio (ver docs).
   - Borrado logico (Eliminado + FechaEliminacion): en un sistema financiero
     no se destruyen registros.
   - Concurrencia: las ediciones y cambios de estado leen la fila con
     UPDLOCK dentro de una transaccion, asi dos usuarios no se pisan.
   - Fechas en UTC (DATETIME2): el cliente las convierte a hora local.
   --------------------------------------------------------------------- */
IF OBJECT_ID('dbo.Creditos', 'U') IS NULL
CREATE TABLE dbo.Creditos (
    Id                  INT IDENTITY(1,1)  NOT NULL,
    NumeroCredito       VARCHAR(20)        NOT NULL,
    AsociadoId          INT                NOT NULL,
    TipoCredito         VARCHAR(30)        NOT NULL,
    ValorSolicitado     DECIMAL(18,2)      NOT NULL,
    TasaInteres         DECIMAL(7,4)       NOT NULL,
    NumeroCuotas        INT                NOT NULL,
    FormaPago           VARCHAR(20)        NOT NULL,
    Estado              VARCHAR(20)        NOT NULL CONSTRAINT DF_Creditos_Estado DEFAULT 'SOLICITADO',
    FechaSolicitud      DATETIME2(3)       NOT NULL CONSTRAINT DF_Creditos_FechaSolicitud DEFAULT SYSUTCDATETIME(),
    FechaActualizacion  DATETIME2(3)       NOT NULL CONSTRAINT DF_Creditos_FechaActualizacion DEFAULT SYSUTCDATETIME(),
    Eliminado           BIT                NOT NULL CONSTRAINT DF_Creditos_Eliminado DEFAULT 0,
    FechaEliminacion    DATETIME2(3)       NULL,
    CONSTRAINT PK_Creditos PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT UQ_Creditos_NumeroCredito UNIQUE (NumeroCredito),
    CONSTRAINT FK_Creditos_Asociados FOREIGN KEY (AsociadoId) REFERENCES dbo.Asociados (Id),
    CONSTRAINT CK_Creditos_Valor   CHECK (ValorSolicitado > 0),
    CONSTRAINT CK_Creditos_Tasa    CHECK (TasaInteres >= 0),
    CONSTRAINT CK_Creditos_Cuotas  CHECK (NumeroCuotas > 0),
    CONSTRAINT CK_Creditos_Estado  CHECK (Estado IN
        ('SOLICITADO','EN_ESTUDIO','APROBADO','RECHAZADO','DESEMBOLSADO','CANCELADO')),
    CONSTRAINT CK_Creditos_TipoCredito CHECK (TipoCredito IN
        ('LIBRE_INVERSION','VIVIENDA','VEHICULO','EDUCACION','CALAMIDAD')),
    CONSTRAINT CK_Creditos_FormaPago CHECK (FormaPago IN
        ('NOMINA','CAJA','DEBITO_AUTOMATICO','PSE')),
    CONSTRAINT CK_Creditos_Eliminacion CHECK ((Eliminado = 0 AND FechaEliminacion IS NULL)
                                           OR (Eliminado = 1 AND FechaEliminacion IS NOT NULL))
);
GO

/* Indices: cada uno responde a una consulta concreta de la API. */

-- Listado y dashboard: filtro por estado, orden por fecha. Cubre las columnas
-- del listado y excluye los borrados.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Creditos_Estado_Fecha')
    CREATE NONCLUSTERED INDEX IX_Creditos_Estado_Fecha
        ON dbo.Creditos (Estado, FechaSolicitud DESC)
        INCLUDE (NumeroCredito, AsociadoId, ValorSolicitado, TipoCredito)
        WHERE Eliminado = 0;
GO

-- Creditos de un asociado (FK + filtro por identificacion).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Creditos_Asociado')
    CREATE NONCLUSTERED INDEX IX_Creditos_Asociado
        ON dbo.Creditos (AsociadoId, FechaSolicitud DESC)
        WHERE Eliminado = 0;
GO

-- Regla de duplicados garantizada por la base de datos: un asociado no puede
-- tener dos creditos en tramite con el mismo tipo y valor. La API valida antes
-- (mensaje claro); este indice cubre la carrera entre dos solicitudes
-- simultaneas.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Creditos_Duplicado_Curso')
    CREATE UNIQUE NONCLUSTERED INDEX UX_Creditos_Duplicado_Curso
        ON dbo.Creditos (AsociadoId, TipoCredito, ValorSolicitado)
        WHERE Eliminado = 0 AND Estado IN ('SOLICITADO','EN_ESTUDIO','APROBADO');
GO

/* ---------------------------------------------------------------------
   HistorialCredito (auditoria: solo se inserta, nunca se modifica)
   - Estado anterior/nuevo, usuario, fecha y observacion.
   - Cambios: JSON {campo: {antes, despues}} para ediciones, sin crear una
     columna por cada campo editable.
   - Usuario es texto y no FK: el historial conserva quien actuo aunque la
     cuenta se desactive despues.
   --------------------------------------------------------------------- */
IF OBJECT_ID('dbo.HistorialCredito', 'U') IS NULL
CREATE TABLE dbo.HistorialCredito (
    Id              BIGINT IDENTITY(1,1) NOT NULL,
    CreditoId       INT                  NOT NULL,
    Accion          VARCHAR(20)          NOT NULL,
    EstadoAnterior  VARCHAR(20)          NULL,
    EstadoNuevo     VARCHAR(20)          NULL,
    Usuario         VARCHAR(100)         NOT NULL,
    Observacion     NVARCHAR(500)        NULL,
    Cambios         NVARCHAR(MAX)        NULL,
    Fecha           DATETIME2(3)         NOT NULL CONSTRAINT DF_Historial_Fecha DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_HistorialCredito PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT FK_Historial_Creditos FOREIGN KEY (CreditoId) REFERENCES dbo.Creditos (Id),
    CONSTRAINT CK_Historial_Accion CHECK (Accion IN ('CREACION','ACTUALIZACION','CAMBIO_ESTADO','ELIMINACION')),
    CONSTRAINT CK_Historial_Cambios CHECK (Cambios IS NULL OR ISJSON(Cambios) = 1)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Historial_Credito_Fecha')
    CREATE NONCLUSTERED INDEX IX_Historial_Credito_Fecha
        ON dbo.HistorialCredito (CreditoId, Fecha DESC);
GO

/* ---------------------------------------------------------------------
   WebhookOutbox (patron Transactional Outbox)
   - Se inserta en la MISMA transaccion que el credito: si el credito se
     crea, el evento queda registrado; si falla, no hay evento fantasma.
   - Un worker lee los pendientes y los envia.
   - EventId (GUID) permite al sistema externo deduplicar (idempotencia).
   - ProximoIntento hace de "lease": al reclamar un evento se adelanta, y
     si el worker muere el evento vuelve a quedar disponible solo.
   --------------------------------------------------------------------- */
IF OBJECT_ID('dbo.WebhookOutbox', 'U') IS NULL
CREATE TABLE dbo.WebhookOutbox (
    Id               BIGINT IDENTITY(1,1) NOT NULL,
    EventId          UNIQUEIDENTIFIER     NOT NULL CONSTRAINT DF_Outbox_EventId DEFAULT NEWID(),
    Evento           VARCHAR(50)          NOT NULL,
    CreditoId        INT                  NOT NULL,
    Payload          NVARCHAR(MAX)        NOT NULL,
    Estado           VARCHAR(15)          NOT NULL CONSTRAINT DF_Outbox_Estado DEFAULT 'PENDIENTE',
    Intentos         INT                  NOT NULL CONSTRAINT DF_Outbox_Intentos DEFAULT 0,
    UltimoCodigoHttp INT                  NULL,
    UltimoError      NVARCHAR(500)        NULL,
    ProximoIntento   DATETIME2(3)         NOT NULL CONSTRAINT DF_Outbox_Proximo DEFAULT SYSUTCDATETIME(),
    FechaCreacion    DATETIME2(3)         NOT NULL CONSTRAINT DF_Outbox_Creacion DEFAULT SYSUTCDATETIME(),
    FechaEnvio       DATETIME2(3)         NULL,
    CONSTRAINT PK_WebhookOutbox PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT UQ_Outbox_EventId UNIQUE (EventId),
    CONSTRAINT FK_Outbox_Creditos FOREIGN KEY (CreditoId) REFERENCES dbo.Creditos (Id),
    CONSTRAINT CK_Outbox_Estado CHECK (Estado IN ('PENDIENTE','ENVIADO','FALLIDO')),
    CONSTRAINT CK_Outbox_Payload CHECK (ISJSON(Payload) = 1)
);
GO

-- El worker solo consulta los pendientes: indice filtrado, pequeno y rapido.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Outbox_Pendientes')
    CREATE NONCLUSTERED INDEX IX_Outbox_Pendientes
        ON dbo.WebhookOutbox (ProximoIntento, Id)
        WHERE Estado = 'PENDIENTE';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Outbox_Credito')
    CREATE NONCLUSTERED INDEX IX_Outbox_Credito ON dbo.WebhookOutbox (CreditoId);
GO

/* ---------------------------------------------------------------------
   WebhookIntento: traza de CADA intento de envio (codigo HTTP, error,
   duracion). Responde "que paso con la notificacion de este credito".
   --------------------------------------------------------------------- */
IF OBJECT_ID('dbo.WebhookIntento', 'U') IS NULL
CREATE TABLE dbo.WebhookIntento (
    Id             BIGINT IDENTITY(1,1) NOT NULL,
    OutboxId       BIGINT               NOT NULL,
    NumeroIntento  INT                  NOT NULL,
    Fecha          DATETIME2(3)         NOT NULL CONSTRAINT DF_Intento_Fecha DEFAULT SYSUTCDATETIME(),
    CodigoHttp     INT                  NULL,
    Exito          BIT                  NOT NULL,
    Error          NVARCHAR(500)        NULL,
    DuracionMs     INT                  NOT NULL,
    CONSTRAINT PK_WebhookIntento PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT FK_Intento_Outbox FOREIGN KEY (OutboxId) REFERENCES dbo.WebhookOutbox (Id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Intento_Outbox')
    CREATE NONCLUSTERED INDEX IX_Intento_Outbox ON dbo.WebhookIntento (OutboxId, NumeroIntento);
GO
