const { expect } = require("chai")
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs")
const { ethers } = require("hardhat")
const { keccak256, AbiCoder } = require("ethers")

const FINALIZED_MASK  = BigInt(01)
const SUCCESSFUL_MASK = BigInt(10)
const ZERO            = BigInt(0)

describe("Crowdfunding + RewardToken", function () {
    async function deploy() {
        const [deployer, alice, bob, carol, dave] = await ethers.getSigners()

        const RewardToken = await ethers.getContractFactory("RewardToken")
        const token = await RewardToken.deploy("Crowd Reward", "CRWD", deployer.address)

        const Crowdfunding = await ethers.getContractFactory("Crowdfunding")
        const crowdfund = await Crowdfunding.deploy(await token.getAddress())

        const MINTER_ROLE = await token.MINTER_ROLE()
        await token.grantRole(MINTER_ROLE, await crowdfund.getAddress())

        return { deployer, alice, bob, carol, dave, token, crowdfund, MINTER_ROLE }
    }

    async function timeTravel(seconds) {
        await ethers.provider.send("evm_increaseTime", [seconds])
        await ethers.provider.send("evm_mine", [])
    }

    function wei(nEth) {
        return ethers.parseEther(String(nEth))
    }

    async function gasCost(txPromise) {
        const tx = await txPromise
        const receipt = await tx.wait()
        return receipt.gasUsed * receipt.gasPrice
    }

    function expectFinalized(c) {
        return expect((c.flags & FINALIZED_MASK) != ZERO)
    }
    
    function expectSuccessful(c) {
        return expect((c.flags & SUCCESSFUL_MASK) != ZERO)
    }

    describe("RewardToken access control", function () {
        it("only MINTER_ROLE can mint", async function () {
            const { token, alice } = await deploy()
            await expect(token.connect(alice).mint(alice.address, 1n))
                .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount")
        })
    })

    describe("createCampaign", function () {
        it("reverts on empty title", async function () {
            const { crowdfund, alice } = await deploy()
            await expect(
                crowdfund.connect(alice).createCampaign("", wei(1), 3600)
            ).to.be.revertedWithCustomError(crowdfund, "TitleEmpty")
        })

        it("reverts on zero goal", async function () {
            const { crowdfund, alice } = await deploy()
            await expect(
                crowdfund.connect(alice).createCampaign("X", 0, 3600)
            ).to.be.revertedWithCustomError(crowdfund, "GoalZero")
        })

        it("reverts on zero duration", async function () {
            const { crowdfund, alice } = await deploy()
            await expect(
                crowdfund.connect(alice).createCampaign("X", wei(1), 0)
            ).to.be.revertedWithCustomError(crowdfund, "DurationZero")
        })

        it("emits CampaignCreated and stores data", async function () {
            const { crowdfund, alice } = await deploy()
            
            const goal = wei(1)
            const duration = 3600
            
            const now = (await ethers.provider.getBlock("latest")).timestamp

            const title = "My Campaign"
            const encoded = AbiCoder.defaultAbiCoder().encode(["string"], [title]);
            const titleHash = keccak256(encoded);
            
            const tx = await crowdfund.connect(alice).createCampaign(title, goal, duration)
            
            // Check event (match everything except deadline)
            await expect(tx)
                .to.emit(crowdfund, "CampaignCreated")
                .withArgs(0, alice.address, title, goal, anyValue)
            
            expect(await crowdfund.campaignCount()).to.equal(1)
            
            const c = await crowdfund.campaigns(0)
            expect(c.creator).to.equal(alice.address)
            expect(c.titleHash).to.equal(titleHash)
            expect(c.goalWei).to.equal(goal)
            expect(c.totalRaised).to.equal(0n)
            expect(c.flags).to.equal(0)
            
            // Deadline sanity: should be about now + duration
            const expected = BigInt(now + duration)
            expect(c.deadline).to.be.gte(expected - 5n)
            expect(c.deadline).to.be.lte(expected + 5n)
        })
    })

    describe("contribute", function () {
        it("reverts on bad id", async function () {
            const { crowdfund, bob } = await deploy()
            await expect(crowdfund.connect(bob).contribute(123, { value: wei(1) }))
                .to.be.revertedWithCustomError(crowdfund, "BadId")
        })

        it("reverts on zero value", async function () {
            const { crowdfund, alice, bob } = await deploy()
            await crowdfund.connect(alice).createCampaign("T", wei(1), 3600)
            await expect(crowdfund.connect(bob).contribute(0, { value: 0 }))
                .to.be.revertedWithCustomError(crowdfund, "ZeroValue")
        })

        it("reverts after campaign deadline", async function () {
            const { crowdfund, alice, bob } = await deploy()
            await crowdfund.connect(alice).createCampaign("T", wei(1), 10)

            await timeTravel(11)

            await expect(crowdfund.connect(bob).contribute(0, { value: wei(0.1) }))
                .to.be.revertedWithCustomError(crowdfund, "CampaignEnded")
        })

        it("tracks contributions and totalRaised emits Contributed", async function () {
            const { crowdfund, token, alice, bob } = await deploy()
            await crowdfund.connect(alice).createCampaign("T", wei(10), 3600)

            const v = wei(0.5)

            await expect(crowdfund.connect(bob).contribute(0, { value: v }))
                .to.emit(crowdfund, "Contributed")
                .withArgs(0, bob.address, v, v * 1000n)

            expect(await crowdfund.contributions(0, bob.address)).to.equal(v)

            const c = await crowdfund.campaigns(0)
            expect(c.totalRaised).to.equal(v)

            // reward minted: msg.value * RATE (RATE=1000)
            expect(await token.balanceOf(bob.address)).to.equal(v * 1000n)
        })

        it("mints rewards cumulatively on multiple contributions (same user)", async function () {
            const { crowdfund, token, alice, bob } = await deploy()
            await crowdfund.connect(alice).createCampaign("T", wei(10), 3600)

            const v1 = wei(0.1)
            const v2 = wei(0.2)

            await crowdfund.connect(bob).contribute(0, { value: v1 })
            await crowdfund.connect(bob).contribute(0, { value: v2 })

            expect(await crowdfund.contributions(0, bob.address)).to.equal(v1 + v2)
            expect(await token.balanceOf(bob.address)).to.equal((v1 + v2) * 1000n)

            const c = await crowdfund.campaigns(0)
            expect(c.totalRaised).to.equal(v1 + v2)
        })

        it("supports multiple contributors", async function () {
            const { crowdfund, token, alice, bob, carol } = await deploy()
            await crowdfund.connect(alice).createCampaign("T", wei(10), 3600)

            const vb = wei(0.3)
            const vc = wei(0.7)

            await crowdfund.connect(bob).contribute(0, { value: vb })
            await crowdfund.connect(carol).contribute(0, { value: vc })

            expect(await crowdfund.contributions(0, bob.address)).to.equal(vb)
            expect(await crowdfund.contributions(0, carol.address)).to.equal(vc)

            expect(await token.balanceOf(bob.address)).to.equal(vb * 1000n)
            expect(await token.balanceOf(carol.address)).to.equal(vc * 1000n)

            const c = await crowdfund.campaigns(0)
            expect(c.totalRaised).to.equal(vb + vc)
        })
    })

    describe("finalize", function () {
        it("reverts on bad id", async function () {
            const { crowdfund } = await deploy()
            await expect(crowdfund.finalize(999))
                .to.be.revertedWithCustomError(crowdfund, "BadId")
        })

        it("reverts if not ended yet", async function () {
            const { crowdfund, alice } = await deploy()
            await crowdfund.connect(alice).createCampaign("T", wei(1), 3600)
            await expect(crowdfund.finalize(0))
                .to.be.revertedWithCustomError(crowdfund, "CampaignNotEnded")
        })

        it("sets successful=true when goal reached emits Finalized", async function () {
            const { crowdfund, alice, bob } = await deploy()
            await crowdfund.connect(alice).createCampaign("T", wei(1), 10)

            await crowdfund.connect(bob).contribute(0, { value: wei(1) })
            await timeTravel(11)

            await expect(crowdfund.finalize(0))
                .to.emit(crowdfund, "Finalized")
                .withArgs(0, true)

            const c = await crowdfund.campaigns(0)
            expectFinalized(c).to.equal(true)
            expectSuccessful(c).to.equal(true)
        })

        it("sets successful=false when goal not reached", async function () {
            const { crowdfund, alice, bob } = await deploy()
            await crowdfund.connect(alice).createCampaign("T", wei(2), 10)

            await crowdfund.connect(bob).contribute(0, { value: wei(1) })
            await timeTravel(11)

            await expect(crowdfund.finalize(0))
                .to.emit(crowdfund, "Finalized")
                .withArgs(0, false)

            const c = await crowdfund.campaigns(0)
            expectFinalized(c).to.equal(true)
            expectSuccessful(c).to.equal(false)
        })

        it("reverts on double finalize", async function () {
            const { crowdfund, alice } = await deploy()
            await crowdfund.connect(alice).createCampaign("T", wei(1), 10)
            await timeTravel(11)
            await crowdfund.finalize(0)
            await expect(crowdfund.finalize(0))
                .to.be.revertedWithCustomError(crowdfund, "AlreadyFinalized")
        })
    })

    describe("withdraw (successful campaigns)", function () {
        it("reverts if not finalized", async function () {
            const { crowdfund, alice } = await deploy()
            await crowdfund.connect(alice).createCampaign("T", wei(1), 10)
            await expect(crowdfund.connect(alice).withdraw(0))
                .to.be.revertedWithCustomError(crowdfund, "NotFinalized")
        })

        it("reverts if not successful", async function () {
            const { crowdfund, alice, bob } = await deploy()
            await crowdfund.connect(alice).createCampaign("T", wei(2), 10)
            await crowdfund.connect(bob).contribute(0, { value: wei(1) })
            await timeTravel(11)
            await crowdfund.finalize(0)
            await expect(crowdfund.connect(alice).withdraw(0))
                .to.be.revertedWithCustomError(crowdfund, "NotSuccessful")
        })

        it("reverts if caller not creator", async function () {
            const { crowdfund, alice, bob } = await deploy()
            await crowdfund.connect(alice).createCampaign("T", wei(1), 10)
            await crowdfund.connect(bob).contribute(0, { value: wei(1) })
            await timeTravel(11)
            await crowdfund.finalize(0)

            await expect(crowdfund.connect(bob).withdraw(0))
                .to.be.revertedWithCustomError(crowdfund, "NotCreator")
        })

        it("transfers raised ETH to creator, emits Withdrawn, and prevents double withdraw", async function () {
            const { crowdfund, alice, bob, carol } = await deploy()
            await crowdfund.connect(alice).createCampaign("T", wei(1), 10)

            const b1 = wei(0.4)
            const b2 = wei(0.6)
            await crowdfund.connect(bob).contribute(0, { value: b1 })
            await crowdfund.connect(carol).contribute(0, { value: b2 })

            await timeTravel(11)
            await crowdfund.finalize(0)

            const amount = b1 + b2

            const before = await ethers.provider.getBalance(alice.address)
            const gas = await gasCost(crowdfund.connect(alice).withdraw(0))
            const after = await ethers.provider.getBalance(alice.address)

            expect(after).to.equal(before + amount - gas)

            await expect(crowdfund.connect(alice).withdraw(0))
                .to.be.revertedWithCustomError(crowdfund, "WithdrawNothing")
        })
    })

    describe("refund (failed campaigns)", function () {
        it("reverts if not finalized", async function () {
            const { crowdfund, alice, bob } = await deploy()
            await crowdfund.connect(alice).createCampaign("T", wei(2), 10)
            await crowdfund.connect(bob).contribute(0, { value: wei(1) })
            await expect(crowdfund.connect(bob).refund(0))
                .to.be.revertedWithCustomError(crowdfund, "NotFinalized")
        })

        it("reverts if campaign successful", async function () {
            const { crowdfund, alice, bob } = await deploy()
            await crowdfund.connect(alice).createCampaign("T", wei(1), 10)
            await crowdfund.connect(bob).contribute(0, { value: wei(1) })
            await timeTravel(11)
            await crowdfund.finalize(0)

            await expect(crowdfund.connect(bob).refund(0))
                .to.be.revertedWithCustomError(crowdfund, "AlreadyFinalized")
        })

        it("reverts if contributor has nothing to refund", async function () {
            const { crowdfund, alice, bob, carol } = await deploy()
            await crowdfund.connect(alice).createCampaign("T", wei(2), 10)
            await crowdfund.connect(bob).contribute(0, { value: wei(1) })
            await timeTravel(11)
            await crowdfund.finalize(0)

            await expect(crowdfund.connect(carol).refund(0))
                .to.be.revertedWithCustomError(crowdfund, "RefundNothing")
        })

        it("refunds correct amount, emits Refunded, clears contribution, and prevents double refund", async function () {
            const { crowdfund, alice, bob } = await deploy()
            await crowdfund.connect(alice).createCampaign("T", wei(2), 10)

            const contrib = wei(0.75)
            await crowdfund.connect(bob).contribute(0, { value: contrib })

            await timeTravel(11)
            await crowdfund.finalize(0)

            const before = await ethers.provider.getBalance(bob.address)
            const gas = await gasCost(crowdfund.connect(bob).refund(0))
            const after = await ethers.provider.getBalance(bob.address)

            expect(after).to.equal(before + contrib - gas)

            expect(await crowdfund.contributions(0, bob.address)).to.equal(0n)

            await expect(crowdfund.connect(bob).refund(0))
                .to.be.revertedWithCustomError(crowdfund, "RefundNothing")
        })

        it("refund reduces campaign totalRaised accordingly", async function () {
            const { crowdfund, alice, bob, carol } = await deploy()
            await crowdfund.connect(alice).createCampaign("T", wei(10), 10)

            const vb = wei(1)
            const vc = wei(2)
            await crowdfund.connect(bob).contribute(0, { value: vb })
            await crowdfund.connect(carol).contribute(0, { value: vc })

            await timeTravel(11)
            await crowdfund.finalize(0) // should be failed since goal=10, raised=3

            let c = await crowdfund.campaigns(0)
            expect(c.totalRaised).to.equal(vb + vc)

            await crowdfund.connect(bob).refund(0)
            c = await crowdfund.campaigns(0)
            expect(c.totalRaised).to.equal(vc)

            await crowdfund.connect(carol).refund(0)
            c = await crowdfund.campaigns(0)
            expect(c.totalRaised).to.equal(0n)
        })
    })

    describe("misc / invariants", function () {
        it("rate constant is 1000", async function () {
            const { crowdfund } = await deploy()
            expect(await crowdfund.RATE()).to.equal(1000n)
        })

        it("campaignCount increments with multiple campaigns", async function () {
            const { crowdfund, alice } = await deploy()
            await crowdfund.connect(alice).createCampaign("A", wei(1), 100)
            await crowdfund.connect(alice).createCampaign("B", wei(2), 200)
            expect(await crowdfund.campaignCount()).to.equal(2)
        })

        it("cannot contribute after finalize only if deadline passed (finalize doesn't stop early contributions)", async function () {
            const { crowdfund, alice, bob } = await deploy()
            await crowdfund.connect(alice).createCampaign("T", wei(1), 100)

            // before deadline contribution works
            await crowdfund.connect(bob).contribute(0, { value: wei(0.1) })

            // cannot finalize before end
            await expect(crowdfund.finalize(0))
                .to.be.revertedWithCustomError(crowdfund, "CampaignNotEnded")
        })
    })
})
