# The AWS side of the nightly backup (docs/13 §1, §2): the bucket, its lifecycle, GitHub's OIDC
# provider and the role the Backup workflow assumes. Applied by hand from Yuta's machine, never from
# CI. The state bucket comes from ./state, applied once before this.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.66"
    }
  }
  # use_lockfile: S3's own conditional writes lock the state; no DynamoDB table.
  backend "s3" {
    bucket       = "overload-tfstate-yutaasakura96"
    key          = "infra/aws/terraform.tfstate"
    region       = "ap-northeast-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = "ap-northeast-1"
  default_tags {
    tags = { project = "overload", managed_by = "terraform/infra/aws" }
  }
}
