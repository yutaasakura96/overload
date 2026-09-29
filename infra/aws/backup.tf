locals {
  repository = "yutaasakura96/overload"
  # The GitHub environment the Backup workflow's job runs in (.github/workflows/backup.yml). It admits
  # develop only, so a pull request or another branch cannot present this subject.
  github_environment = "backup"
}

# ── The bucket ──────────────────────────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "backups" {
  bucket = "overload-backups-yutaasakura96"
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration {
    status = "Enabled"
  }
}

# SSE-S3 on top of the age encryption the dump already has (docs/13 §2).
resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Current dumps expire after 30 days, earlier versions 7 days after they stop being current.
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  # Versioning must be on before a noncurrent-version rule means anything.
  depends_on = [aws_s3_bucket_versioning.backups]

  rule {
    id     = "expire-dumps"
    status = "Enabled"
    filter {}
    expiration {
      days = 30
    }
    noncurrent_version_expiration {
      noncurrent_days = 7
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# TLS only, for everyone, Yuta's own reads included.
resource "aws_s3_bucket_policy" "backups" {
  bucket = aws_s3_bucket.backups.id
  # Block Public Access first, so the policy is never evaluated against an open bucket.
  depends_on = [aws_s3_bucket_public_access_block.backups]
  policy     = data.aws_iam_policy_document.backups_bucket.json
}

data "aws_iam_policy_document" "backups_bucket" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.backups.arn,
      "${aws_s3_bucket.backups.arn}/*",
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

# ── GitHub OIDC and the role ────────────────────────────────────────────────────────────────────

# AWS validates GitHub's tokens against its own trusted CAs, so no thumbprint is configured.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_role" "backup" {
  name                 = "overload-backup"
  description          = "Assumed by the Backup workflow of ${local.repository} through GitHub OIDC. Write-only."
  assume_role_policy   = data.aws_iam_policy_document.backup_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "backup_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${local.repository}:environment:${local.github_environment}"]
    }
  }
}

# The role can put a dump and nothing else: it cannot read, list or delete (docs/13 §4).
resource "aws_iam_role_policy" "backup" {
  name   = "put-backups"
  role   = aws_iam_role.backup.id
  policy = data.aws_iam_policy_document.backup_put.json
}

data "aws_iam_policy_document" "backup_put" {
  statement {
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.backups.arn}/backups/*"]
  }
}

# ── For the variables of the `backup` GitHub environment, which the workflow reads ──────────────

output "backup_bucket" {
  description = "Environment variable BACKUP_BUCKET."
  value       = aws_s3_bucket.backups.bucket
}

output "backup_role_arn" {
  description = "Environment variable BACKUP_ROLE_ARN."
  value       = aws_iam_role.backup.arn
}
