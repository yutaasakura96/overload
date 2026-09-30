# The bucket that holds infra/aws's Terraform state (docs/13 §1). Applied once, by hand, before
# infra/aws itself: that configuration keeps its state here, so this one cannot, and its own few
# lines of state stay in a local, gitignored terraform.tfstate. If that file is lost, re-import:
#   terraform import aws_s3_bucket.state overload-tfstate-yutaasakura96

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.66"
    }
  }
}

provider "aws" {
  region = "ap-northeast-1"
  default_tags {
    tags = { project = "overload", managed_by = "terraform/infra/aws/state" }
  }
}

resource "aws_s3_bucket" "state" {
  bucket = "overload-tfstate-yutaasakura96"
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Every earlier state is kept, so a bad apply can be walked back.
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

output "bucket" {
  value = aws_s3_bucket.state.bucket
}
