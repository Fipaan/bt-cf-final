// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./RewardToken.sol";

contract Crowdfunding {
    struct Campaign {
        address creator;
        bytes32 titleHash;
        uint128 goalWei;
        uint256 totalRaised;
        uint64  deadline;    // unix timestamp
        uint8   flags;       // bit0=finalized, bit1=successful
    }
    
    uint8 public constant FINALIZED_MASK  = 1; // 0b01
    uint8 public constant SUCCESSFUL_MASK = 2; // 0b10

    RewardToken public immutable rewardToken;

    // 1 ETH (1e18 wei) => 1000 tokens (1000 * 1e18 token units)
    uint256 public constant RATE = 1000;

    Campaign[] public campaigns;

    // campaignId => contributor => amountWei
    mapping(uint256 => mapping(address => uint256)) public contributions;

    event CampaignCreated(uint256 indexed id, address indexed creator, string title, uint256 goalWei, uint64 deadline);
    event Contributed(uint256 indexed id, address indexed contributor, uint256 amountWei, uint256 rewardMinted);
    event Finalized(uint256 indexed id, bool successful);
    event Withdrawn(uint256 indexed id, address indexed creator, uint256 amountWei);
    event Refunded(uint256 indexed id, address indexed contributor, uint256 amountWei);

    error GoalZero();
    error DurationZero();
    error TitleEmpty();

    error BadId();
    error CampaignEnded();
    error ZeroValue();
    
    error AlreadyFinalized();
    error CampaignNotEnded();
    
    error NotFinalized();
    error NotSuccessful();
    error NotCreator();
    error WithdrawNothing();
    error WithdrawFailed();
    
    error RefundNothing();
    error RefundFailed();

    constructor(address rewardTokenAddress) {
        rewardToken = RewardToken(rewardTokenAddress);
    }

    function createCampaign(
        string calldata title,
        uint128 goalWei,
        uint64 durationSeconds
    ) external returns (uint256 id) {
        if (bytes(title).length == 0) revert TitleEmpty();
        if (goalWei             == 0) revert GoalZero();
        if (durationSeconds     == 0) revert DurationZero();

        uint64 deadline = uint64(block.timestamp) + durationSeconds;

        campaigns.push(Campaign({
            creator:     msg.sender,
            titleHash:   bytes32(keccak256(abi.encode(title))),
            goalWei:     goalWei,
            deadline:    deadline,
            totalRaised: 0,
            flags:       0
        }));

        id = campaigns.length - 1;
        emit CampaignCreated(id, msg.sender, title, goalWei, deadline);
    }

    function contribute(uint256 id) external payable {
        if (id >= campaigns.length) revert BadId();

        Campaign storage c = campaigns[id];
        unchecked {
            if (block.timestamp >= c.deadline) revert CampaignEnded();
        }
        if (msg.value == 0) revert ZeroValue();

        c.totalRaised += msg.value;
        contributions[id][msg.sender] += msg.value;

        // Mint reward tokens proportional to contribution
        // msg.value is wei; token has 18 decimals; RATE=1000 => 1 ETH => 1000 tokens
        uint256 rewardAmount = msg.value * RATE;
        rewardToken.mint(msg.sender, rewardAmount);

        emit Contributed(id, msg.sender, msg.value, rewardAmount);
    }

    function finalize(uint256 id) external {
        if (id >= campaigns.length) revert BadId();

        Campaign storage c = campaigns[id];
        if ((c.flags & FINALIZED_MASK) != 0) revert AlreadyFinalized();
        unchecked {
            if (block.timestamp < c.deadline) revert CampaignNotEnded();
        }

        c.flags = FINALIZED_MASK;
        bool successful = c.totalRaised >= c.goalWei;
        if (successful) c.flags |= SUCCESSFUL_MASK;

        emit Finalized(id, successful);
    }

    function withdraw(uint256 id) external {
        if (id >= campaigns.length) revert BadId();

        Campaign storage c = campaigns[id];
        if ((c.flags & FINALIZED_MASK)  == 0) revert NotFinalized();
        if ((c.flags & SUCCESSFUL_MASK) == 0) revert NotSuccessful();
        address creator = c.creator;
        if (msg.sender != creator) revert NotCreator();

        uint256 amount = c.totalRaised;
        if (amount == 0) revert WithdrawNothing();

        // effects
        c.totalRaised = 0;

        // interaction
        (bool ok, ) = creator.call{value: amount}("");
        if (!ok) revert WithdrawFailed();

        emit Withdrawn(id, c.creator, amount);
    }

    function refund(uint256 id) external {
        if (id >= campaigns.length) revert BadId();

        Campaign storage c = campaigns[id];
        if ((c.flags & FINALIZED_MASK)  == 0) revert NotFinalized();
        if ((c.flags & SUCCESSFUL_MASK) != 0) revert AlreadyFinalized();

        uint256 amount = contributions[id][msg.sender];
        if (amount == 0) revert RefundNothing();

        // effects
        contributions[id][msg.sender] = 0;
        c.totalRaised -= amount;

        // interaction
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert RefundFailed();

        emit Refunded(id, msg.sender, amount);
    }

    function campaignCount() external view returns (uint256) {
        return campaigns.length;
    }
}
